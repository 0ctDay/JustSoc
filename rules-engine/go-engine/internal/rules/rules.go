package rules

import (
	"strings"

	"justsoc/engine/internal/normalize"
)

type Rule struct {
	ID            string
	Category      string
	Stage         string
	Match         func(event normalize.ThreatEvent) bool
	Reason        string
	SuccessSignal bool
}

func Default() []Rule {
	return []Rule{
		{
			ID:       "engine.sqli.blind.sleep.001",
			Category: "sqli",
			Stage:    "attempt",
			Match: func(event normalize.ThreatEvent) bool {
				payload := strings.ToLower(event.PayloadPrintable + " " + event.HTTPURL)
				return strings.Contains(payload, "sleep(") || strings.Contains(payload, "benchmark(") || strings.Contains(payload, "waitfor delay") || strings.Contains(payload, "pg_sleep(") || strings.Contains(payload, "extractvalue(") || strings.Contains(payload, "updatexml(")
			},
			Reason:        "blind_sqli_timing_payload_detected",
			SuccessSignal: true,
		},
		{
			ID:       "engine.log4j.callback.seed.001",
			Category: "log4j",
			Stage:    "attempt",
			Match: func(event normalize.ThreatEvent) bool {
				payload := strings.ToLower(event.PayloadPrintable + " " + event.HTTPURL)
				return strings.Contains(payload, "${jndi:") || strings.Contains(payload, "%24%7b") && strings.Contains(payload, "jndi") || strings.Contains(payload, "${lower:j}") || strings.Contains(payload, "${::-j}")
			},
			Reason:        "jndi_payload_detected",
			SuccessSignal: true,
		},
		{
			ID:       "engine.path.read.sensitive.001",
			Category: "file_read",
			Stage:    "attempt",
			Match: func(event normalize.ThreatEvent) bool {
				payload := strings.ToLower(event.PayloadPrintable + " " + event.HTTPURL)
				return (strings.Contains(payload, "../") || strings.Contains(payload, "%2e%2e") || strings.Contains(payload, "%252e%252e") || strings.Contains(payload, "..\\")) &&
					(strings.Contains(payload, "/etc/passwd") || strings.Contains(payload, "/etc/shadow") || strings.Contains(payload, "win.ini") || strings.Contains(payload, "web.xml") || strings.Contains(payload, "application.properties") || strings.Contains(payload, ".git/config") || strings.Contains(payload, ".env"))
			},
			Reason: "sensitive_file_target_detected",
		},
		{
			ID:       "engine.cmdi.exec.001",
			Category: "cmdi",
			Stage:    "attempt",
			Match: func(event normalize.ThreatEvent) bool {
				payload := strings.ToLower(event.PayloadPrintable + " " + event.HTTPURL)
				return (strings.Contains(payload, "&&") || strings.Contains(payload, ";") || strings.Contains(payload, "|") || strings.Contains(payload, "$()") || strings.Contains(payload, "${ifs}") || strings.Contains(payload, "%0a")) &&
					(strings.Contains(payload, "curl") || strings.Contains(payload, "wget") || strings.Contains(payload, "powershell") || strings.Contains(payload, "certutil") || strings.Contains(payload, "whoami") || strings.Contains(payload, "/bin/sh") || strings.Contains(payload, "bash -c") || strings.Contains(payload, "cmd.exe"))
			},
			Reason: "command_injection_payload_detected",
		},
	}
}
