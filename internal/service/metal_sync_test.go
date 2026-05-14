package service

import "testing"

func TestExtractByDataTestReadsElementText(t *testing.T) {
	body := `<div class="price" data-test="instrument-price-last">714.71</div><span data-test="instrument-price-change">+7.47</span>`
	if got := extractByDataTest(body, "instrument-price-last"); got != "714.71" {
		t.Fatalf("expected instrument-price-last to be 714.71, got %q", got)
	}
}

func TestExtractByDataTestFallsBackToNestedSpan(t *testing.T) {
	body := `<div data-test="instrument-price-last"><span>3348.25</span></div>`
	if got := extractByDataTest(body, "instrument-price-last"); got != "3348.25" {
		t.Fatalf("expected nested span fallback to be 3348.25, got %q", got)
	}
}
