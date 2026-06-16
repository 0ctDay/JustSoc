package eve

import (
	"encoding/json"
	"fmt"
	"strings"
)

type Parser struct{}

func NewParser() *Parser {
	return &Parser{}
}

func (p *Parser) Parse(line string) (Event, error) {
	var event Event
	decoder := json.NewDecoder(strings.NewReader(line))
	decoder.UseNumber()
	if err := decoder.Decode(&event); err != nil {
		return nil, fmt.Errorf("parse eve line: %w", err)
	}
	if event == nil {
		event = Event{}
	}
	return event, nil
}
