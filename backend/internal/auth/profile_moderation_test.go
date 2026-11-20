package auth

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestNormalizeProfileNicknameReplacesForbiddenTerms(t *testing.T) {
	for _, value := range []string{"色情主播", "傻逼", "ABC 操你妈", "色.情"} {
		got, err := NormalizeProfileNickname(value)
		if err != nil || got != forbiddenProfileNickname {
			t.Errorf("NormalizeProfileNickname(%q) = %q, %v", value, got, err)
		}
	}
	for _, value := range []string{"小明", "内容创作者", "MeiyeAI"} {
		got, err := NormalizeProfileNickname(value)
		if err != nil || got != value {
			t.Errorf("NormalizeProfileNickname(%q) = %q, %v", value, got, err)
		}
	}
	if got := NormalizeDisplayName("色情主播", "fallback"); got != forbiddenProfileNickname {
		t.Fatalf("NormalizeDisplayName() = %q", got)
	}
}

func TestModerateProfileAvatarCallsLocalClassifier(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/moderate" || r.Header.Get("Content-Type") != "image/jpeg" {
			t.Errorf("unexpected request: %s %s %v", r.Method, r.URL.Path, r.Header)
		}
		got, err := io.ReadAll(r.Body)
		if err != nil || string(got) != "test" {
			t.Errorf("request body = %q, error = %v", got, err)
		}
		_ = json.NewEncoder(w).Encode(ProfileAvatarDecision{Action: "review", Score: .51, Model: "test-model"})
	}))
	defer server.Close()
	t.Setenv("CANVAS_PROFILE_MODERATOR_URL", server.URL)
	decision, err := ModerateProfileAvatar(context.Background(), []byte("test"))
	if err != nil || decision.Action != "review" || decision.Score != .51 || decision.Model != "test-model" {
		t.Fatalf("ModerateProfileAvatar() = %+v, %v", decision, err)
	}
}

func TestModerateProfileAvatarRejectsInvalidClassifierResponse(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"action":"pass","score":2,"model":"fake"}`))
	}))
	defer server.Close()
	t.Setenv("CANVAS_PROFILE_MODERATOR_URL", server.URL)
	if _, err := ModerateProfileAvatar(context.Background(), []byte("test")); err == nil {
		t.Fatal("invalid classifier score accepted")
	}
}
