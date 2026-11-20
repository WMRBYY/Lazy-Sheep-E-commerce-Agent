package auth

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"golang.org/x/text/unicode/norm"
)

const forbiddenProfileNickname = "违规昵称"

var forbiddenProfileTerms = []string{
	"色情", "裸体", "淫秽", "强奸", "卖淫", "嫖娼", "约炮", "三级片", "成人片",
	"杀人", "自杀", "炸弹", "制毒", "贩毒", "枪支", "恐怖袭击", "诈骗", "赌博",
	"操你妈", "他妈的", "去死", "傻逼", "煞笔", "狗杂种", "畜生", "婊子", "妓女",
}

func containsForbiddenProfileTerm(value string) bool {
	normalized := normalizeModerationText(value)
	for _, term := range forbiddenProfileTerms {
		if strings.Contains(normalized, normalizeModerationText(term)) {
			return true
		}
	}
	return false
}

func IsForbiddenProfileNickname(value string) bool { return containsForbiddenProfileTerm(value) }

func normalizeModerationText(value string) string {
	var normalized strings.Builder
	for _, r := range norm.NFKC.String(strings.ToLower(value)) {
		if r >= 'a' && r <= 'z' || r >= '0' && r <= '9' || r >= '\u4e00' && r <= '\u9fff' {
			normalized.WriteRune(r)
		}
	}
	return normalized.String()
}

type ProfileAvatarDecision struct {
	Action string  `json:"action"`
	Score  float64 `json:"score"`
	Model  string  `json:"model"`
}

// ModerateProfileAvatar calls the locally hosted Open-NSFW2 classifier. The
// model detects pornographic content only; ambiguous scores are held for review.
func ModerateProfileAvatar(ctx context.Context, payload []byte) (ProfileAvatarDecision, error) {
	endpoint := strings.TrimRight(strings.TrimSpace(os.Getenv("CANVAS_PROFILE_MODERATOR_URL")), "/")
	if endpoint == "" {
		endpoint = "http://profile-moderator:8000"
	}
	client := &http.Client{Timeout: 20 * time.Second}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint+"/moderate", bytes.NewReader(payload))
	if err != nil {
		return ProfileAvatarDecision{}, err
	}
	request.Header.Set("Content-Type", "image/jpeg")
	response, err := client.Do(request)
	if err != nil {
		return ProfileAvatarDecision{}, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return ProfileAvatarDecision{}, fmt.Errorf("local profile moderation returned HTTP %d", response.StatusCode)
	}
	var result ProfileAvatarDecision
	if err := json.NewDecoder(io.LimitReader(response.Body, 16<<10)).Decode(&result); err != nil {
		return ProfileAvatarDecision{}, err
	}
	if result.Score < 0 || result.Score > 1 || (result.Action != "pass" && result.Action != "block" && result.Action != "review") {
		return ProfileAvatarDecision{}, errors.New("local profile moderation returned an invalid decision")
	}
	if result.Model == "" {
		result.Model = "open-nsfw2"
	}
	return result, nil
}

func whiteProfileAvatarPNG() ([]byte, error) {
	img := image.NewRGBA(image.Rect(0, 0, maxProfileAvatarSide, maxProfileAvatarSide))
	for y := 0; y < maxProfileAvatarSide; y++ {
		for x := 0; x < maxProfileAvatarSide; x++ {
			img.Set(x, y, color.White)
		}
	}
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, img); err != nil {
		return nil, err
	}
	return encoded.Bytes(), nil
}
