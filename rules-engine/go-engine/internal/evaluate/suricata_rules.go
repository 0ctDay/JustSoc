package evaluate

import "strings"

var suricataRulesDir string

func SetSuricataRulesDir(path string) {
	suricataRulesDir = strings.TrimSpace(path)
}
