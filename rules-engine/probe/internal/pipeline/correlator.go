package pipeline

import (
	"encoding/json"
	"fmt"
	"time"

	"justsoc/probe/internal/eve"
)

const (
	correlatedHTTPField = "correlated_http"
	correlationTTL      = 30 * time.Second
)

type correlator struct {
	ttl   time.Duration
	flows map[string]*flowState
}

type flowState struct {
	httpEvents    []cachedHTTPEvent
	pendingAlerts []pendingAlert
}

type cachedHTTPEvent struct {
	txID      string
	event     eve.Event
	expiresAt time.Time
}

type pendingAlert struct {
	txID      string
	event     eve.Event
	expiresAt time.Time
}

func newCorrelator() *correlator {
	return &correlator{
		ttl:   correlationTTL,
		flows: map[string]*flowState{},
	}
}

func (c *correlator) Process(now time.Time, event eve.Event) []eve.Event {
	switch eventType(event) {
	case "http":
		c.storeHTTP(now, event)
		ready := []eve.Event{event}
		ready = append(ready, c.releaseMatchedAlerts(now, event)...)
		return ready
	case "alert":
		if matched := c.correlateAlert(event); matched != nil {
			return []eve.Event{matched}
		}
		c.storeAlert(now, event)
		return nil
	default:
		return []eve.Event{event}
	}
}

func (c *correlator) FlushExpired(now time.Time) []eve.Event {
	ready := make([]eve.Event, 0)
	for flowID, state := range c.flows {
		state.httpEvents = filterHTTPEvents(state.httpEvents, now)

		pending := state.pendingAlerts[:0]
		for _, alert := range state.pendingAlerts {
			if now.After(alert.expiresAt) {
				ready = append(ready, alert.event)
				continue
			}
			pending = append(pending, alert)
		}
		state.pendingAlerts = pending

		if len(state.httpEvents) == 0 && len(state.pendingAlerts) == 0 {
			delete(c.flows, flowID)
		}
	}
	return ready
}

func (c *correlator) storeHTTP(now time.Time, event eve.Event) {
	flowID := eventKey(event, "flow_id")
	if flowID == "" {
		return
	}

	state := c.flow(flowID)
	txID := eventKey(event, "tx_id")
	cached := cachedHTTPEvent{
		txID:      txID,
		event:     cloneEvent(event),
		expiresAt: now.Add(c.ttl),
	}

	for i, existing := range state.httpEvents {
		if txID != "" && existing.txID == txID {
			state.httpEvents[i] = cached
			return
		}
	}
	state.httpEvents = append(state.httpEvents, cached)
}

func (c *correlator) releaseMatchedAlerts(now time.Time, event eve.Event) []eve.Event {
	flowID := eventKey(event, "flow_id")
	if flowID == "" {
		return nil
	}

	state, ok := c.flows[flowID]
	if !ok || len(state.pendingAlerts) == 0 {
		return nil
	}

	ready := make([]eve.Event, 0)
	pending := state.pendingAlerts[:0]
	for _, alert := range state.pendingAlerts {
		if now.After(alert.expiresAt) {
			ready = append(ready, alert.event)
			continue
		}
		matched := c.matchHTTPEvent(flowID, alert.txID)
		if matched == nil {
			pending = append(pending, alert)
			continue
		}
		ready = append(ready, withCorrelatedHTTP(alert.event, matched.event))
	}
	state.pendingAlerts = pending
	return ready
}

func (c *correlator) correlateAlert(event eve.Event) eve.Event {
	flowID := eventKey(event, "flow_id")
	if flowID == "" {
		return event
	}

	matched := c.matchHTTPEvent(flowID, eventKey(event, "tx_id"))
	if matched == nil {
		return nil
	}
	return withCorrelatedHTTP(event, matched.event)
}

func (c *correlator) storeAlert(now time.Time, event eve.Event) {
	flowID := eventKey(event, "flow_id")
	if flowID == "" {
		return
	}

	state := c.flow(flowID)
	state.pendingAlerts = append(state.pendingAlerts, pendingAlert{
		txID:      eventKey(event, "tx_id"),
		event:     cloneEvent(event),
		expiresAt: now.Add(c.ttl),
	})
}

func (c *correlator) flow(flowID string) *flowState {
	state, ok := c.flows[flowID]
	if ok {
		return state
	}
	state = &flowState{}
	c.flows[flowID] = state
	return state
}

func (c *correlator) matchHTTPEvent(flowID, txID string) *cachedHTTPEvent {
	state, ok := c.flows[flowID]
	if !ok || len(state.httpEvents) == 0 {
		return nil
	}

	if txID != "" {
		for i := range state.httpEvents {
			if state.httpEvents[i].txID == txID {
				return &state.httpEvents[i]
			}
		}
		return nil
	}

	if len(state.httpEvents) == 1 {
		return &state.httpEvents[0]
	}
	return nil
}

func filterHTTPEvents(events []cachedHTTPEvent, now time.Time) []cachedHTTPEvent {
	kept := events[:0]
	for _, event := range events {
		if now.After(event.expiresAt) {
			continue
		}
		kept = append(kept, event)
	}
	return kept
}

func eventType(event eve.Event) string {
	return fmt.Sprint(event["event_type"])
}

func eventKey(event eve.Event, key string) string {
	value, ok := event[key]
	if !ok || value == nil {
		return ""
	}

	switch typed := value.(type) {
	case json.Number:
		return typed.String()
	case string:
		return typed
	default:
		return fmt.Sprint(typed)
	}
}

func withCorrelatedHTTP(alert eve.Event, httpEvent eve.Event) eve.Event {
	enriched := cloneEvent(alert)
	enriched[correlatedHTTPField] = cloneEvent(httpEvent)
	return enriched
}

func cloneEvent(event eve.Event) eve.Event {
	cloned := make(eve.Event, len(event))
	for key, value := range event {
		cloned[key] = value
	}
	return cloned
}
