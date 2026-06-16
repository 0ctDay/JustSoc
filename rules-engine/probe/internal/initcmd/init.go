package initcmd

import (
	"bufio"
	"flag"
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"justsoc/probe/internal/config"
)

type interfaceChoice struct {
	name  string
	addrs []string
}

func Run(args []string) error {
	fs := flag.NewFlagSet("init", flag.ContinueOnError)
	fs.SetOutput(os.Stderr)

	configPath := fs.String("config", "configs/probe.example.yaml", "source probe config template")
	outputPath := fs.String("output", "configs/probe.yaml", "output probe config path")
	interfaceName := fs.String("interface", "", "probe/suricata capture interface")
	kafkaBrokers := fs.String("kafka-brokers", "", "comma-separated Kafka broker addresses")
	kafkaUsername := fs.String("kafka-username", "", "Kafka SASL username")
	kafkaPassword := fs.String("kafka-password", "", "Kafka SASL password")
	force := fs.Bool("force", false, "overwrite output probe config if it already exists")

	if err := fs.Parse(args); err != nil {
		return err
	}

	if !*force {
		if _, err := os.Stat(*outputPath); err == nil {
			fmt.Printf("probe config already exists: %s\n", *outputPath)
			fmt.Println("init skipped; remove the file or rerun with --force to regenerate it.")
			return nil
		} else if !os.IsNotExist(err) {
			return fmt.Errorf("check output probe config %s: %w", *outputPath, err)
		}
	}

	cfg, err := config.LoadEditable(*configPath)
	if err != nil {
		return err
	}

	reader := bufio.NewReader(os.Stdin)

	selectedInterface := strings.TrimSpace(*interfaceName)
	if selectedInterface == "" && cfg.Probe.Mode == config.ModeManaged && strings.TrimSpace(cfg.Suricata.PCAPFile) == "" {
		selectedInterface, err = promptInterface(os.Stdout, reader)
		if err != nil {
			return err
		}
	}
	if selectedInterface != "" {
		selectedInterfaces := parseDelimitedList(selectedInterface)
		if len(selectedInterfaces) == 0 {
			selectedInterfaces = []string{selectedInterface}
		}
		cfg.Probe.Interface = selectedInterfaces[0]
		cfg.Probe.Interfaces = selectedInterfaces
		cfg.Suricata.Interface = selectedInterfaces[0]
		cfg.Suricata.Interfaces = selectedInterfaces
		// Auto-populate the whitelist with the selected interface's local IPs
		// so Suricata excludes traffic to/from the local machine by default.
		// Two entries per IP per protocol: src_ip matches outbound, dst_ip matches inbound.
		ips := localIPsForInterfaces(selectedInterfaces)
		if len(ips) > 0 {
			entries := make([]config.WhitelistEntry, 0, len(ips)*4)
			for _, ip := range ips {
				for _, proto := range []string{"tcp", "udp"} {
					entries = append(entries, config.WhitelistEntry{
						Protocol: proto,
						SrcIP:    ip,
						SrcPort:  "any",
						DstIP:    "any",
						DstPort:  "any",
					})
					entries = append(entries, config.WhitelistEntry{
						Protocol: proto,
						SrcIP:    "any",
						SrcPort:  "any",
						DstIP:    ip,
						DstPort:  "any",
					})
				}
			}
			cfg.Suricata.Whitelist = entries
		}
	}

	brokers := parseCommaList(*kafkaBrokers)
	if len(brokers) == 0 && cfg.Probe.Output == config.OutputKafka {
		brokers, err = promptKafkaBrokers(os.Stdout, reader, cfg.Kafka.Brokers)
		if err != nil {
			return err
		}
	}
	if len(brokers) > 0 {
		cfg.Kafka.Brokers = brokers
	}

	if strings.TrimSpace(*kafkaUsername) != "" {
		cfg.Kafka.Username = *kafkaUsername
	}
	if strings.TrimSpace(*kafkaPassword) != "" {
		cfg.Kafka.Password = *kafkaPassword
	}

	managedConfigPath, sourcePath, captureFilterPath, ruleDir, err := RegenerateManagedSuricataConfig(cfg.Suricata.ConfigPath, cfg.Suricata.Logs, cfg.Suricata.Whitelist)
	if err != nil {
		return err
	}

	cfg.Suricata.ConfigPath = managedConfigPath
	cfg.Suricata.RuleDir = ruleDir
	cfg.Suricata.ManagedCaptureFilterPath = captureFilterPath

	if err := ensureParentDir(*outputPath); err != nil {
		return err
	}
	if err := config.Save(*outputPath, cfg); err != nil {
		return err
	}

	fmt.Printf("probe config written: %s\n", *outputPath)
	fmt.Printf("suricata config written: %s\n", managedConfigPath)
	fmt.Printf("suricata config source: %s\n", sourcePath)
	fmt.Printf("suricata rule directory: %s\n", ruleDir)
	fmt.Printf("capture filter written: %s\n", captureFilterPath)
	return nil
}

func promptInterface(out io.Writer, reader *bufio.Reader) (string, error) {
	interfaces, err := listCaptureInterfaces()
	if err != nil {
		return "", err
	}
	if len(interfaces) == 0 {
		return promptRequiredLine(out, reader, "No active non-loopback interfaces detected. Enter capture interface: ")
	}

	fmt.Fprintln(out, "Select capture interface:")
	for index, iface := range interfaces {
		addrText := ""
		if len(iface.addrs) > 0 {
			addrText = " (" + strings.Join(iface.addrs, ", ") + ")"
		}
		fmt.Fprintf(out, "  %d) %s%s\n", index+1, iface.name, addrText)
	}

	for {
		fmt.Fprintf(out, "Interface [1]: ")
		line, err := readLine(reader)
		if err != nil {
			return "", err
		}
		line = strings.TrimSpace(line)
		if line == "" {
			return interfaces[0].name, nil
		}
		if index, err := strconv.Atoi(line); err == nil {
			if index >= 1 && index <= len(interfaces) {
				return interfaces[index-1].name, nil
			}
			fmt.Fprintf(out, "Invalid selection %d; choose 1-%d.\n", index, len(interfaces))
			continue
		}
		return line, nil
	}
}

func listCaptureInterfaces() ([]interfaceChoice, error) {
	systemInterfaces, err := net.Interfaces()
	if err != nil {
		return nil, fmt.Errorf("list network interfaces: %w", err)
	}

	choices := make([]interfaceChoice, 0, len(systemInterfaces))
	for _, iface := range systemInterfaces {
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
			continue
		}
		choice := interfaceChoice{name: iface.Name}
		addrs, err := iface.Addrs()
		if err == nil {
			for _, addr := range addrs {
				choice.addrs = append(choice.addrs, addr.String())
			}
		}
		choices = append(choices, choice)
	}
	return choices, nil
}

// localIPsForInterface returns all IP addresses (as plain strings, without CIDR
// prefix lengths) bound to the named network interface. Returns nil when the
// interface cannot be found or has no addresses.
func localIPsForInterface(name string) []string {
	iface, err := net.InterfaceByName(name)
	if err != nil {
		return nil
	}
	addrs, err := iface.Addrs()
	if err != nil {
		return nil
	}
	ips := make([]string, 0, len(addrs))
	for _, addr := range addrs {
		var ipStr string
		switch v := addr.(type) {
		case *net.IPNet:
			ipStr = v.IP.String()
		case *net.IPAddr:
			ipStr = v.IP.String()
		}
		if ipStr != "" {
			ips = append(ips, ipStr)
		}
	}
	return ips
}

func localIPsForInterfaces(names []string) []string {
	seen := make(map[string]struct{})
	ips := make([]string, 0)
	for _, name := range names {
		for _, ip := range localIPsForInterface(name) {
			if _, ok := seen[ip]; ok {
				continue
			}
			seen[ip] = struct{}{}
			ips = append(ips, ip)
		}
	}
	return ips
}

func promptKafkaBrokers(out io.Writer, reader *bufio.Reader, defaults []string) ([]string, error) {
	defaults = normalizeList(defaults)
	prompt := "Kafka broker addresses, comma-separated"
	if len(defaults) > 0 {
		prompt += " [" + strings.Join(defaults, ",") + "]"
	}
	prompt += ": "

	for {
		fmt.Fprint(out, prompt)
		line, err := readLine(reader)
		if err != nil {
			return nil, err
		}
		brokers := parseCommaList(line)
		if len(brokers) == 0 {
			brokers = defaults
		}
		if len(brokers) > 0 {
			return brokers, nil
		}
		fmt.Fprintln(out, "Kafka broker addresses are required when probe.output is kafka.")
	}
}

func promptRequiredLine(out io.Writer, reader *bufio.Reader, prompt string) (string, error) {
	for {
		fmt.Fprint(out, prompt)
		line, err := readLine(reader)
		if err != nil {
			return "", err
		}
		line = strings.TrimSpace(line)
		if line != "" {
			return line, nil
		}
		fmt.Fprintln(out, "Value is required.")
	}
}

func readLine(reader *bufio.Reader) (string, error) {
	line, err := reader.ReadString('\n')
	if err == io.EOF && line == "" {
		return "", err
	}
	if err != nil && err != io.EOF {
		return "", err
	}
	return strings.TrimRight(line, "\r\n"), nil
}

func parseCommaList(value string) []string {
	return parseDelimitedList(value)
}

func parseDelimitedList(value string) []string {
	return normalizeList(strings.FieldsFunc(value, func(r rune) bool {
		return r == ',' || r == ';'
	}))
}

func normalizeList(values []string) []string {
	normalized := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
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

func ensureParentDir(path string) error {
	dir := filepath.Dir(path)
	if dir == "." || dir == "" {
		return nil
	}
	return os.MkdirAll(dir, 0755)
}
