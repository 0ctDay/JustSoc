import { createReadStream, existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { TaskManager } from "./lib/task-manager.js";
import type {
  SendMessageRequest,
  StartTaskRequest,
  TaskDecisionRequest,
} from "./lib/types.js";

const APP_ROOT = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const PUBLIC_ROOT = path.join(APP_ROOT, "public");
const DATA_ROOT = path.join(APP_ROOT, "data");
const PORT = Number(process.env.PORT || "4317");
const HOST = "0.0.0.0";

const manager = new TaskManager();

function writeJson(response: ServerResponse, statusCode: number, payload: unknown) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload, null, 2));
}

function writeError(response: ServerResponse, statusCode: number, message: string) {
  writeJson(response, statusCode, {
    error: true,
    message,
  });
}

function getRequestUrl(request: IncomingMessage) {
  return new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
}

async function readJsonBody<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 1024 * 1024) {
      throw new Error("Request body exceeds 1 MB.");
    }
    chunks.push(buffer);
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) {
    return {} as T;
  }

  return JSON.parse(raw) as T;
}

function matchTaskRoute(pathname: string) {
  const match = pathname.match(/^\/api\/tasks\/([^/]+)(?:\/([^/]+))?$/);
  if (!match) {
    return undefined;
  }
  return {
    taskId: decodeURIComponent(match[1]),
    action: match[2],
  };
}

function serveStaticFile(response: ServerResponse, filePath: string) {
  if (!existsSync(filePath)) {
    writeError(response, 404, "Static asset not found.");
    return;
  }

  const extension = path.extname(filePath).toLowerCase();
  const contentType =
    extension === ".html"
      ? "text/html; charset=utf-8"
      : extension === ".js"
        ? "text/javascript; charset=utf-8"
        : extension === ".css"
          ? "text/css; charset=utf-8"
          : "application/octet-stream";

  response.writeHead(200, {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
  });
  createReadStream(filePath).pipe(response);
}

function openEventStream(response: ServerResponse) {
  response.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store",
    Connection: "keep-alive",
  });
  response.write(": connected\n\n");
}

function sendEvent(response: ServerResponse, payload: unknown) {
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
}

async function handleApi(request: IncomingMessage, response: ServerResponse) {
  const url = getRequestUrl(request);
  const pathname = url.pathname;
  const method = request.method || "GET";

  if (pathname === "/api/health" && method === "GET") {
    writeJson(response, 200, {
      ok: true,
      service: "justsoc-claude-code-bridge",
      port: PORT,
    });
    return;
  }

  if (pathname === "/api/defaults" && method === "GET") {
    writeJson(response, 200, manager.getDefaults());
    return;
  }

  if (pathname === "/api/tasks" && method === "GET") {
    writeJson(response, 200, {
      tasks: manager.listTasks(),
    });
    return;
  }

  if (pathname === "/api/tasks" && method === "POST") {
    const body = await readJsonBody<StartTaskRequest>(request);
    if (!body.prompt || !body.prompt.trim()) {
      writeError(response, 400, "prompt is required.");
      return;
    }

    const task = await manager.createTask(body);
    writeJson(response, 201, { task });
    return;
  }

  const taskRoute = matchTaskRoute(pathname);
  if (!taskRoute) {
    writeError(response, 404, "Unknown API route.");
    return;
  }

  const { taskId, action } = taskRoute;

  if (!action && method === "GET") {
    const task = manager.getTask(taskId);
    if (!task) {
      writeError(response, 404, "Task not found.");
      return;
    }
    writeJson(response, 200, { task });
    return;
  }

  if (!action && method === "DELETE") {
    const task = await manager.deleteTask(taskId);
    writeJson(response, 200, { task });
    return;
  }

  if (action === "events" && method === "GET") {
    const task = manager.getTask(taskId);
    if (!task) {
      writeError(response, 404, "Task not found.");
      return;
    }

    openEventStream(response);
    sendEvent(response, { type: "snapshot", task });
    const unsubscribe = manager.subscribe(taskId, (event) => {
      sendEvent(response, event);
    });

    const keepAlive = setInterval(() => {
      response.write(": ping\n\n");
    }, 15000);

    request.on("close", () => {
      clearInterval(keepAlive);
      unsubscribe();
      response.end();
    });
    return;
  }

  if (action === "messages" && method === "POST") {
    const body = await readJsonBody<SendMessageRequest>(request);
    if (!body.content || !body.content.trim()) {
      writeError(response, 400, "content is required.");
      return;
    }
    const task = await manager.sendMessage(taskId, body);
    writeJson(response, 200, { task });
    return;
  }

  if (action === "decision" && method === "POST") {
    const body = await readJsonBody<TaskDecisionRequest>(request);
    if (!body.requestId) {
      writeError(response, 400, "requestId is required.");
      return;
    }
    const task = await manager.respondToDecision(taskId, body);
    writeJson(response, 200, { task });
    return;
  }

  if (action === "interrupt" && method === "POST") {
    const task = await manager.interruptTask(taskId);
    writeJson(response, 200, { task });
    return;
  }

  if (action === "session-info" && method === "GET") {
    const info = await manager.getSessionInfo(taskId);
    writeJson(response, 200, { info });
    return;
  }

  writeError(response, 404, "Unsupported task route.");
}

async function requestListener(request: IncomingMessage, response: ServerResponse) {
  try {
    const url = getRequestUrl(request);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(request, response);
      return;
    }

    if (url.pathname === "/" || url.pathname === "/index.html") {
      serveStaticFile(response, path.join(PUBLIC_ROOT, "index.html"));
      return;
    }

    if (url.pathname === "/app.js") {
      serveStaticFile(response, path.join(PUBLIC_ROOT, "app.js"));
      return;
    }

    if (url.pathname === "/styles.css") {
      serveStaticFile(response, path.join(PUBLIC_ROOT, "styles.css"));
      return;
    }

    writeError(response, 404, "Route not found.");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    writeError(response, 500, message);
  }
}

async function bootstrap() {
  const defaults = manager.getDefaults();
  await mkdir(DATA_ROOT, { recursive: true });
  await mkdir(defaults.workspaceRoot, { recursive: true });
  await manager.init();

  const server = http.createServer((request, response) => {
    void requestListener(request, response);
  });

  server.listen(PORT, HOST, () => {
    console.log(`Claude bridge listening on http://${HOST}:${PORT}`);
  });
}

void bootstrap();
