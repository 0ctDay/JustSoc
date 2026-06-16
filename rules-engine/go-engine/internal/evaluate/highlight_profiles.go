package evaluate

type highlightProfile struct {
	fields []string
	terms  []string
}

func loadHighlightProfiles() (map[int]highlightProfile, error) {
	return loadSuricataHighlightProfiles()
}

func loadSuricataHighlightProfiles() (map[int]highlightProfile, error) {
	fields := []string{"http.request", "http.url", "http.host", "http.response", "dns.query"}
	profiles := map[int]highlightProfile{}

	addRange := func(start, end int, terms []string) {
		for sid := start; sid <= end; sid++ {
			profiles[sid] = highlightProfile{fields: fields, terms: terms}
		}
	}

	addRange(1000001, 1000099, []string{"sleep(", "benchmark(", "waitfor delay", "pg_sleep(", "extractvalue(", "updatexml(", "union select"})
	addRange(1001001, 1001099, []string{"<script", "%3cscript", "javascript:", "onerror=", "onload=", "srcdoc="})
	addRange(1002001, 1002199, []string{"&&", ";", "|", "$()", "${ifs}", "whoami", "/bin/sh", "cmd.exe", "powershell"})
	addRange(1003001, 1003099, []string{"../", "%2e%2e", "/etc/passwd", "win.ini", "web.xml", ".env", ".git/config"})
	addRange(1004001, 1004099, []string{"multipart/form-data", "filename=", ".php", ".jsp", ".aspx", "<?php"})
	addRange(1005001, 1005099, []string{"rememberme", "shiro", "ysoserial"})
	addRange(1006001, 1006099, []string{"${jndi:", "${lower:j}", "${::-j}", "%24%7b", "ldap://", "rmi://", "dns://"})
	addRange(1007001, 1007099, []string{"\"@type\"", "JdbcRowSetImpl", "JndiObjectFactory", "TemplatesImpl", "ldap://", "rmi://"})
	addRange(1009001, 1009009, []string{"sql syntax", "root:x:0:0:", "uid=", "gid=", "Microsoft Windows [Version", "NT AUTHORITY\\SYSTEM"})

	return profiles, nil
}
