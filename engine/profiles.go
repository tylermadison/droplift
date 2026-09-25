package engine

import (
	"bufio"
	"os"
	"path/filepath"
	"strings"
)

type awsProfile struct {
	Name   string `json:"name"`
	Region string `json:"region"`
	SSO    bool   `json:"sso"`
}

// awsProfiles lists the named profiles in the user's AWS config, in file order (PRD A2).
// The SDK has no public call for this, so it reads the file itself.
func awsProfiles() ([]awsProfile, error) {
	path := os.Getenv("AWS_CONFIG_FILE")
	if path == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return nil, err
		}
		path = filepath.Join(home, ".aws", "config")
	}
	f, err := os.Open(path)
	if os.IsNotExist(err) {
		return []awsProfile{}, nil
	}
	if err != nil {
		return nil, err
	}
	defer f.Close()

	profiles := []awsProfile{}
	var current *awsProfile
	scan := bufio.NewScanner(f)
	for scan.Scan() {
		line := strings.TrimSpace(scan.Text())
		if strings.HasPrefix(line, "[") && strings.HasSuffix(line, "]") {
			current = nil
			section := strings.TrimSpace(line[1 : len(line)-1])
			name, isProfile := strings.CutPrefix(section, "profile ")
			if section == "default" || isProfile {
				if section == "default" {
					name = "default"
				}
				profiles = append(profiles, awsProfile{Name: strings.TrimSpace(name)})
				current = &profiles[len(profiles)-1]
			}
			continue
		}
		key, value, ok := strings.Cut(line, "=")
		if current == nil || !ok {
			continue
		}
		switch strings.TrimSpace(key) {
		case "region":
			current.Region = strings.TrimSpace(value)
		case "sso_session", "sso_start_url":
			current.SSO = true
		}
	}
	return profiles, scan.Err()
}
