package supervisor

import (
	"reflect"
	"testing"

	"justsoc/probe/internal/config"
)

func TestCommandArgsIncludesManagedCaptureFilter(t *testing.T) {
	s := &Supervisor{
		cfg: config.SuricataConfig{
			ConfigPath:               "/tmp/suricata.yaml",
			LogDir:                   "/tmp/logs",
			Interface:                "eth1",
			ManagedCaptureFilterPath: "/tmp/probe-whitelist.generated.bpf",
			ExtraArgs:                []string{"-k", "none"},
		},
		probe: config.ProbeConfig{
			Interface: "eth0",
		},
	}

	got := s.commandArgs()
	want := []string{"-c", "/tmp/suricata.yaml", "-l", "/tmp/logs", "-i", "eth1", "-F", "/tmp/probe-whitelist.generated.bpf", "-k", "none"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("commandArgs() = %v, want %v", got, want)
	}
}

func TestCommandArgsIncludesMultipleInterfaces(t *testing.T) {
	s := &Supervisor{
		cfg: config.SuricataConfig{
			ConfigPath:               "/tmp/suricata.yaml",
			LogDir:                   "/tmp/logs",
			Interfaces:               []string{"eth1", "eth2"},
			ManagedCaptureFilterPath: "/tmp/probe-whitelist.generated.bpf",
		},
		probe: config.ProbeConfig{
			Interface: "eth0",
		},
	}

	got := s.commandArgs()
	want := []string{"-c", "/tmp/suricata.yaml", "-l", "/tmp/logs", "-i", "eth1", "-i", "eth2", "-F", "/tmp/probe-whitelist.generated.bpf"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("commandArgs() = %v, want %v", got, want)
	}
}

func TestCommandArgsParsesCommaSeparatedInterface(t *testing.T) {
	s := &Supervisor{
		cfg: config.SuricataConfig{
			ConfigPath: "/tmp/suricata.yaml",
			Interface:  "eth1, eth2",
		},
	}

	got := s.commandArgs()
	want := []string{"-c", "/tmp/suricata.yaml", "-i", "eth1", "-i", "eth2"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("commandArgs() = %v, want %v", got, want)
	}
}

func TestCommandArgsPrefersPCAPFileOverInterface(t *testing.T) {
	s := &Supervisor{
		cfg: config.SuricataConfig{
			ConfigPath: "/tmp/suricata.yaml",
			PCAPFile:   "/tmp/input.pcap",
			Interface:  "eth1",
		},
		probe: config.ProbeConfig{
			Interface: "eth0",
		},
	}

	got := s.commandArgs()
	want := []string{"-c", "/tmp/suricata.yaml", "-r", "/tmp/input.pcap"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("commandArgs() = %v, want %v", got, want)
	}
}
