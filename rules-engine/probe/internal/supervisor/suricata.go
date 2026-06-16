package supervisor

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"log/slog"
	"os/exec"
	"strings"
	"sync"
	"syscall"
	"time"

	"justsoc/probe/internal/config"
)

type Supervisor struct {
	cfg        config.SuricataConfig
	probe      config.ProbeConfig
	log        *slog.Logger
	mu         sync.Mutex
	ctx        context.Context
	cmd        *exec.Cmd
	errCh      chan error
	generation uint64
}

func New(cfg config.SuricataConfig, probe config.ProbeConfig, logger *slog.Logger) *Supervisor {
	return &Supervisor{cfg: cfg, probe: probe, log: logger}
}

func (s *Supervisor) Start(ctx context.Context) (<-chan error, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.ctx = ctx
	if s.errCh == nil {
		s.errCh = make(chan error, 1)
	}
	if err := s.startLocked(); err != nil {
		return nil, err
	}
	return s.errCh, nil
}

func (s *Supervisor) Restart() error {
	s.mu.Lock()
	if s.ctx == nil {
		s.mu.Unlock()
		return fmt.Errorf("suricata supervisor is not started")
	}
	old := s.cmd
	s.generation++
	s.cmd = nil
	ctx := s.ctx
	s.mu.Unlock()

	if old != nil && old.Process != nil {
		_ = old.Process.Signal(syscall.SIGTERM)
		time.Sleep(500 * time.Millisecond)
		if old.ProcessState == nil || !old.ProcessState.Exited() {
			_ = old.Process.Kill()
			time.Sleep(200 * time.Millisecond)
		}
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	s.ctx = ctx
	return s.startLocked()
}

func (s *Supervisor) startLocked() error {
	args := s.commandArgs()

	cmd := exec.CommandContext(s.ctx, s.cfg.Binary, args...)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf("open suricata stdout: %w", err)
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return fmt.Errorf("open suricata stderr: %w", err)
	}
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("start suricata: %w", err)
	}

	s.generation++
	generation := s.generation
	s.cmd = cmd
	s.log.Info("suricata started", "binary", s.cfg.Binary, "args", args)
	go s.stream("stdout", stdout)
	go s.stream("stderr", stderr)
	go s.wait(cmd, generation)
	return nil
}

func (s *Supervisor) wait(cmd *exec.Cmd, generation uint64) {
	if err := cmd.Wait(); err != nil {
		s.mu.Lock()
		active := s.cmd == cmd && s.generation == generation
		ctxErr := s.ctx != nil && s.ctx.Err() != nil
		s.mu.Unlock()
		if !ctxErr && active {
			s.errCh <- fmt.Errorf("wait for suricata: %w", err)
		}
	}
}

func (s *Supervisor) interfaceNames() []string {
	if len(s.cfg.Interfaces) > 0 {
		return normalizeInterfaces(s.cfg.Interfaces)
	}
	if ifaces := splitInterfaces(s.cfg.Interface); len(ifaces) > 0 {
		return ifaces
	}
	if len(s.probe.Interfaces) > 0 {
		return normalizeInterfaces(s.probe.Interfaces)
	}
	return splitInterfaces(s.probe.Interface)
}

func (s *Supervisor) commandArgs() []string {
	args := []string{"-c", s.cfg.ConfigPath}
	if s.cfg.LogDir != "" {
		args = append(args, "-l", s.cfg.LogDir)
	}
	if s.cfg.PCAPFile != "" {
		args = append(args, "-r", s.cfg.PCAPFile)
	} else {
		for _, iface := range s.interfaceNames() {
			args = append(args, "-i", iface)
		}
	}
	if s.cfg.ManagedCaptureFilterPath != "" {
		args = append(args, "-F", s.cfg.ManagedCaptureFilterPath)
	}
	return append(args, s.cfg.ExtraArgs...)
}

func splitInterfaces(value string) []string {
	return normalizeInterfaces(strings.FieldsFunc(value, func(r rune) bool {
		return r == ',' || r == ';'
	}))
}

func normalizeInterfaces(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	normalized := make([]string, 0, len(values))
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			continue
		}
		if _, ok := seen[trimmed]; ok {
			continue
		}
		seen[trimmed] = struct{}{}
		normalized = append(normalized, trimmed)
	}
	return normalized
}

func (s *Supervisor) stream(stream string, reader io.Reader) {
	scanner := bufio.NewScanner(reader)
	for scanner.Scan() {
		s.log.Info("suricata output", "stream", stream, "line", scanner.Text())
	}
	if err := scanner.Err(); err != nil {
		s.log.Warn("suricata stream error", "stream", stream, "error", err)
	}
}
