package service

import (
	"testing"
	"time"
)

func TestNextQuestionQIDStaysInJSSafeRange(t *testing.T) {
	lastGeneratedQuestionQID.Store(0)

	qid := nextQuestionQID(time.UnixMilli(1745820000000))
	if qid <= 0 {
		t.Fatalf("expected positive qid, got %d", qid)
	}
	if qid > maxSafeQuestionQID {
		t.Fatalf("expected qid to stay within JS safe integer range, got %d", qid)
	}
}

func TestNextQuestionQIDMonotonicWithinSameMillisecond(t *testing.T) {
	lastGeneratedQuestionQID.Store(0)

	now := time.UnixMilli(1745820000000)
	first := nextQuestionQID(now)
	second := nextQuestionQID(now)

	if first != 1745820000000 {
		t.Fatalf("expected first qid to equal current millisecond, got %d", first)
	}
	if second != first+1 {
		t.Fatalf("expected second qid to increment from first, got first=%d second=%d", first, second)
	}
}
