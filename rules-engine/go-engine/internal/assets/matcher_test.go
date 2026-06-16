package assets

import "testing"

const sampleAssetYAML = `
schema_version: 1
version: "assets-test"
entries:
  - asset_id: "web-01"
    asset_name: "Web 01"
    enabled: true
    bindings:
      - binding_id: "web-01-cidr"
        match_type: "cidr"
        match_value: "10.0.0.0/24"
        network_type: "internal"
        priority: 10
        enabled: true
      - binding_id: "web-01-exact"
        match_type: "ip"
        match_value: "10.0.0.8"
        network_type: "internal"
        priority: 20
        enabled: true
  - asset_id: "public-egress"
    asset_name: "Public Egress"
    enabled: true
    bindings:
      - binding_id: "public-egress-cidr"
        match_type: "cidr"
        match_value: "203.0.113.0/24"
        network_type: "external"
        priority: 5
        enabled: true
`

func TestMatcherMatchIPAndCIDRByPriority(t *testing.T) {
	matcher, err := Parse([]byte(sampleAssetYAML))
	if err != nil {
		t.Fatal(err)
	}

	match, ok := matcher.MatchIP("10.0.0.8")
	if !ok {
		t.Fatal("expected exact IP match")
	}
	if match.AssetID != "web-01" || match.BindingID != "web-01-exact" || match.NetworkType != "internal" {
		t.Fatalf("unexpected exact match: %#v", match)
	}

	match, ok = matcher.MatchIP("203.0.113.21")
	if !ok {
		t.Fatal("expected CIDR match")
	}
	if match.AssetName != "Public Egress" || match.NetworkType != "external" {
		t.Fatalf("unexpected CIDR match: %#v", match)
	}
}

func TestEnrichDocument(t *testing.T) {
	matcher, err := Parse([]byte(sampleAssetYAML))
	if err != nil {
		t.Fatal(err)
	}

	document := map[string]any{}
	EnrichDocument(document, matcher, "203.0.113.21", "10.0.0.8")

	asset, ok := document["asset"].(map[string]any)
	if !ok {
		t.Fatalf("asset enrichment missing: %#v", document)
	}
	if asset["version"] != "assets-test" {
		t.Fatalf("unexpected asset version: %#v", asset["version"])
	}
	source := asset["source"].(map[string]any)
	if source["asset_name"] != "Public Egress" {
		t.Fatalf("unexpected source asset: %#v", source)
	}
	selk := document["selk"].(map[string]any)
	if selk["dest_asset_name"] != "Web 01" || selk["src_asset_network_type"] != "external" {
		t.Fatalf("unexpected flat selk asset fields: %#v", selk)
	}
}