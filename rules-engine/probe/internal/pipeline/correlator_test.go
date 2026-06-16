package pipeline

import (
	"encoding/json"
	"testing"
	"time"

	"justsoc/probe/internal/eve"
)

func TestCorrelatorAttachesBufferedHTTPToLaterAlert(t *testing.T) {
	c := newCorrelator()
	now := time.Unix(100, 0)

	ready := c.Process(now, httpEvent("flow-1", "7", "/login"))
	if len(ready) != 1 {
		t.Fatalf("ready events = %d, want 1", len(ready))
	}
	assertRawHTTPURL(t, ready[0], "/login")

	ready = c.Process(now.Add(time.Second), alertEvent("flow-1", "7"))
	if len(ready) != 1 {
		t.Fatalf("ready events = %d, want 1", len(ready))
	}
	assertCorrelatedHTTPURL(t, ready[0], "/login")
}

func TestCorrelatorReleasesPendingAlertWhenHTTPArrivesLater(t *testing.T) {
	c := newCorrelator()
	now := time.Unix(200, 0)

	if ready := c.Process(now, alertEvent("flow-2", "3")); len(ready) != 0 {
		t.Fatalf("ready events = %d, want 0", len(ready))
	}

	ready := c.Process(now.Add(2*time.Second), httpEvent("flow-2", "3", "/heartbeat"))
	if len(ready) != 2 {
		t.Fatalf("ready events = %d, want 2", len(ready))
	}
	assertRawHTTPURL(t, ready[0], "/heartbeat")
	assertCorrelatedHTTPURL(t, ready[1], "/heartbeat")
}

func TestCorrelatorUsesSoleHTTPEventWhenAlertHasNoTxID(t *testing.T) {
	c := newCorrelator()
	now := time.Unix(300, 0)

	ready := c.Process(now, httpEvent("flow-3", "11", "/agent"))
	if len(ready) != 1 {
		t.Fatalf("ready events = %d, want 1", len(ready))
	}
	assertRawHTTPURL(t, ready[0], "/agent")

	ready = c.Process(now.Add(time.Second), alertEvent("flow-3", ""))
	if len(ready) != 1 {
		t.Fatalf("ready events = %d, want 1", len(ready))
	}
	assertCorrelatedHTTPURL(t, ready[0], "/agent")
}

func TestCorrelatorDoesNotGuessWhenMultipleHTTPTransactionsExist(t *testing.T) {
	c := newCorrelator()
	now := time.Unix(400, 0)

	ready := c.Process(now, httpEvent("flow-4", "1", "/one"))
	if len(ready) != 1 {
		t.Fatalf("ready events = %d, want 1", len(ready))
	}
	assertRawHTTPURL(t, ready[0], "/one")

	ready = c.Process(now.Add(time.Second), httpEvent("flow-4", "2", "/two"))
	if len(ready) != 1 {
		t.Fatalf("ready events = %d, want 1", len(ready))
	}
	assertRawHTTPURL(t, ready[0], "/two")

	if ready := c.Process(now.Add(2*time.Second), alertEvent("flow-4", "")); len(ready) != 0 {
		t.Fatalf("ready events = %d, want 0", len(ready))
	}

	ready = c.FlushExpired(now.Add(correlationTTL + 3*time.Second))
	if len(ready) != 1 {
		t.Fatalf("ready events = %d, want 1", len(ready))
	}
	if _, ok := ready[0][correlatedHTTPField]; ok {
		t.Fatal("expired alert should not contain correlated_http")
	}
}

func alertEvent(flowID, txID string) eve.Event {
	event := eve.Event{
		"event_type": "alert",
		"flow_id":    json.Number(flowID),
		"alert": map[string]any{
			"signature": "test-alert",
		},
	}
	if txID != "" {
		event["tx_id"] = json.Number(txID)
	}
	return event
}

func httpEvent(flowID, txID, url string) eve.Event {
	return eve.Event{
		"event_type": "http",
		"flow_id":    json.Number(flowID),
		"tx_id":      json.Number(txID),
		"http": map[string]any{
			"url":         url,
			"http_method": "GET",
		},
	}
}

func assertRawHTTPURL(t *testing.T, event eve.Event, want string) {
	t.Helper()

	if got := event["event_type"]; got != "http" {
		t.Fatalf("event_type = %v, want http", got)
	}
	if _, ok := event[correlatedHTTPField]; ok {
		t.Fatal("raw http event should not contain correlated_http")
	}

	httpData, ok := event["http"].(map[string]any)
	if !ok {
		t.Fatalf("http type = %T, want map[string]any", event["http"])
	}
	if got := httpData["url"]; got != want {
		t.Fatalf("http.url = %v, want %q", got, want)
	}
}

func assertCorrelatedHTTPURL(t *testing.T, event eve.Event, want string) {
	t.Helper()

	correlated, ok := event[correlatedHTTPField].(eve.Event)
	if !ok {
		t.Fatalf("correlated_http type = %T, want eve.Event", event[correlatedHTTPField])
	}

	httpData, ok := correlated["http"].(map[string]any)
	if !ok {
		t.Fatalf("correlated_http.http type = %T, want map[string]any", correlated["http"])
	}
	if got := httpData["url"]; got != want {
		t.Fatalf("correlated_http.http.url = %v, want %q", got, want)
	}
}
