package correlate

import (
	"sync"
	"time"
)

type item struct {
	at    time.Time
	value string
}

type Store struct {
	window time.Duration
	mu     sync.Mutex
	items  map[string][]item
}

func NewStore(window time.Duration) *Store {
	return &Store{
		window: window,
		items:  make(map[string][]item),
	}
}

func (s *Store) Observe(key string, at time.Time) int {
	s.mu.Lock()
	defer s.mu.Unlock()

	at = normalizeTimestamp(at)
	kept := s.pruneLocked(key, at)
	countBefore := len(kept)
	kept = append(kept, item{at: at})
	s.items[key] = kept
	return countBefore
}

func (s *Store) ObserveDistinct(key string, value string, at time.Time) (int, int) {
	s.mu.Lock()
	defer s.mu.Unlock()

	at = normalizeTimestamp(at)
	kept := s.pruneLocked(key, at)
	countBefore := len(kept)
	distinct := make(map[string]struct{}, len(kept)+1)
	for _, entry := range kept {
		if entry.value == "" {
			continue
		}
		distinct[entry.value] = struct{}{}
	}
	if value != "" {
		distinct[value] = struct{}{}
	}
	kept = append(kept, item{at: at, value: value})
	s.items[key] = kept
	return countBefore, len(distinct)
}

func (s *Store) Count(key string, at time.Time) int {
	s.mu.Lock()
	defer s.mu.Unlock()

	at = normalizeTimestamp(at)
	kept := s.pruneLocked(key, at)
	s.items[key] = kept
	return len(kept)
}

func (s *Store) Remember(key string, value string, at time.Time) {
	s.mu.Lock()
	defer s.mu.Unlock()

	at = normalizeTimestamp(at)
	kept := s.pruneLocked(key, at)
	kept = append(kept, item{at: at, value: value})
	s.items[key] = kept
}

func (s *Store) SeenValue(key string, value string, at time.Time) bool {
	s.mu.Lock()
	defer s.mu.Unlock()

	at = normalizeTimestamp(at)
	kept := s.pruneLocked(key, at)
	seen := false
	for _, entry := range kept {
		if entry.value == value {
			seen = true
		}
	}
	s.items[key] = kept
	return seen
}

func (s *Store) pruneLocked(key string, at time.Time) []item {
	cutoff := at.Add(-s.window)
	kept := make([]item, 0, len(s.items[key])+1)
	for _, entry := range s.items[key] {
		if entry.at.After(cutoff) {
			kept = append(kept, entry)
		}
	}
	return kept
}

func normalizeTimestamp(at time.Time) time.Time {
	if at.IsZero() {
		return time.Now().UTC()
	}
	return at
}
