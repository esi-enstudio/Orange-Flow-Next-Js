package whatsapp

import (
	"path"
	"regexp"
	"strings"
)

const maxLiveC2CFileSize = 10 * 1024 * 1024

var liveC2CFilenameWord = regexp.MustCompile(`[a-z0-9]+`)

func isLiveC2CSpreadsheet(filename string, fileLength uint64) bool {
	if fileLength == 0 || fileLength > maxLiveC2CFileSize {
		return false
	}

	basename := path.Base(strings.ReplaceAll(filename, `\`, "/"))
	extension := strings.ToLower(path.Ext(basename))
	if extension != ".xlsx" && extension != ".xlsb" {
		return false
	}

	stem := strings.TrimSuffix(basename, path.Ext(basename))
	words := make(map[string]struct{})
	for _, word := range liveC2CFilenameWord.FindAllString(strings.ToLower(stem), -1) {
		words[word] = struct{}{}
	}
	_, hasLive := words["live"]
	_, hasC2C := words["c2c"]
	return hasLive && hasC2C
}
