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

func TestValidateURLAllowsAllowlistedInsecureHost(t *testing.T) {
	t.Setenv("WEBHOOK_ALLOW_INSECURE_HOSTS", "backend:8000")
	engine := NewEngine(nil)
	defer engine.Shutdown()

	if err := engine.validateURL("http://backend:8000/api/v1/live-c2c-automation/whatsapp/webhook"); err != nil {
		t.Fatalf("allowlisted internal host should be accepted: %v", err)
	}
}

func TestValidateURLRejectsUnlistedInsecureHost(t *testing.T) {
	t.Setenv("WEBHOOK_ALLOW_INSECURE_HOSTS", "backend:8000")
	engine := NewEngine(nil)
	defer engine.Shutdown()

	if err := engine.validateURL("http://other-service:8000/webhook"); err == nil {
		t.Fatal("expected an unlisted HTTP host to be rejected")
	}
}

func TestValidateURLStillRejectsPrivateHTTPSHost(t *testing.T) {
	t.Setenv("WEBHOOK_ALLOW_INSECURE_HOSTS", "")
	engine := NewEngine(nil)
	defer engine.Shutdown()

	if err := engine.validateURL("https://10.0.0.5/webhook"); err == nil {
		t.Fatal("expected a private HTTPS host to be rejected")
	}
}
