package whatsapp

import "testing"

func TestIsLiveC2CSpreadsheet(t *testing.T) {
	tests := []struct {
		name       string
		filename   string
		fileLength uint64
		want       bool
	}{
		{
			name:       "mixed case matching words",
			filename:   "Daily LIVE c2c report.XLSX",
			fileLength: 1024,
			want:       true,
		},
		{
			name:       "xlsb extension",
			filename:   "Live-C2C-report.xlsb",
			fileLength: 1024,
			want:       true,
		},
		{
			name:       "live and c2c must be separate words",
			filename:   "LiveC2C-report.xlsx",
			fileLength: 1024,
			want:       false,
		},
		{
			name:       "missing live word",
			filename:   "Daily C2C report.xlsx",
			fileLength: 1024,
			want:       false,
		},
		{
			name:       "missing c2c word",
			filename:   "Daily Live report.xlsx",
			fileLength: 1024,
			want:       false,
		},
		{
			name:       "unsupported extension",
			filename:   "Live C2C report.csv",
			fileLength: 1024,
			want:       false,
		},
		{
			name:       "exactly ten mib",
			filename:   "Live C2C report.xlsx",
			fileLength: 10 * 1024 * 1024,
			want:       true,
		},
		{
			name:       "larger than ten mib",
			filename:   "Live C2C report.xlsx",
			fileLength: 10*1024*1024 + 1,
			want:       false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := isLiveC2CSpreadsheet(tt.filename, tt.fileLength); got != tt.want {
				t.Fatalf("isLiveC2CSpreadsheet(%q, %d) = %v, want %v", tt.filename, tt.fileLength, got, tt.want)
			}
		})
	}
}
