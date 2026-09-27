package main

import (
	"os"
	"path/filepath"
	"runtime"
)

// Packaged applications resolve their own tools; development uses PATH.
func mediaToolPath(name string) string {
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	executable, err := os.Executable()
	if err == nil {
		base := filepath.Dir(executable)
		candidates := []string{filepath.Join(base, name)}
		if runtime.GOOS == "darwin" {
			candidates = append([]string{filepath.Join(base, "..", "Resources", "media-tools", name)}, candidates...)
		}
		for _, candidate := range candidates {
			if info, statErr := os.Stat(candidate); statErr == nil && info.Mode().IsRegular() {
				return candidate
			}
		}
	}
	return name
}
