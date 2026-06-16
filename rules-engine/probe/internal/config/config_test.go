package config

import "testing"

func TestCaptureInterfacesPrefersSuricataInterfaces(t *testing.T) {
	cfg := &Config{
		Probe: ProbeConfig{
			Interface: "eth0",
		},
		Suricata: SuricataConfig{
			Interfaces: []string{"eth1", "eth2"},
		},
	}

	got := cfg.CaptureInterfaces()
	want := []string{"eth1", "eth2"}
	if len(got) != len(want) {
		t.Fatalf("CaptureInterfaces() = %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("CaptureInterfaces() = %v, want %v", got, want)
		}
	}
}

func TestCaptureInterfacesParsesCommaSeparatedLegacyInterface(t *testing.T) {
	cfg := &Config{
		Suricata: SuricataConfig{
			Interface: "eth1, eth2",
		},
	}

	got := cfg.CaptureInterfaces()
	want := []string{"eth1", "eth2"}
	if len(got) != len(want) {
		t.Fatalf("CaptureInterfaces() = %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("CaptureInterfaces() = %v, want %v", got, want)
		}
	}
}
