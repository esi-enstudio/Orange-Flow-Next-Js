package webhook

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestWebhookHTTPClientAllowsSlowDelivery(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		time.Sleep(11 * time.Second)
		w.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()

	engine := NewEngine(nil)
	defer engine.Shutdown()

	response, err := engine.httpClient.Get(server.URL)
	if err != nil {
		t.Fatalf("webhook request failed before the server responded: %v", err)
	}
	response.Body.Close()
}
