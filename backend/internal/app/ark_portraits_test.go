package app

import (
	"bytes"
	"context"
	"encoding/json"
	"image"
	"image/color"
	"image/png"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"gorm.io/gorm"

	"yingce/backend/internal/model"
)

type fakeArkPortraitControlPlane struct {
	mu          sync.Mutex
	callbackURL string
	actions     []string
	bodies      []map[string]any
	assetStatus string
	groupSeq    int
	assetSeq    int
}

func (f *fakeArkPortraitControlPlane) handler(t *testing.T) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Errorf("decode body: %v", err)
		}
		action := r.URL.Query().Get("Action")
		f.mu.Lock()
		f.actions = append(f.actions, action)
		f.bodies = append(f.bodies, body)
		status := f.assetStatus
		f.mu.Unlock()
		if body["ProjectName"] != "portrait-project" {
			t.Errorf("%s ProjectName = %v", action, body["ProjectName"])
		}
		w.Header().Set("Content-Type", "application/json")
		switch action {
		case "CreateVisualValidateSession":
			f.mu.Lock()
			f.callbackURL, _ = body["CallbackURL"].(string)
			f.mu.Unlock()
			_, _ = w.Write([]byte(`{"Result":{"BytedToken":"byted-token-1","H5Link":"https://h5.example.test/authorization?pl=abc&lng=zh"}}`))
		case "GetVisualValidateResult":
			if body["BytedToken"] != "byted-token-1" {
				t.Errorf("BytedToken = %v", body["BytedToken"])
			}
			_, _ = w.Write([]byte(`{"Result":{"GroupId":"group-20261104-abcde"}}`))
		case "CreateAssetGroup":
			if body["GroupType"] != "AIGC" {
				t.Errorf("CreateAssetGroup GroupType = %v", body["GroupType"])
			}
			f.mu.Lock()
			f.groupSeq++
			id := f.groupSeq
			f.mu.Unlock()
			_, _ = w.Write([]byte(`{"Result":{"Id":"group-aigc-` + string(rune('0'+id)) + `"}}`))
		case "CreateAsset":
			if !strings.HasPrefix(body["GroupId"].(string), "group-") || body["AssetType"] != "Image" || !strings.HasPrefix(body["URL"].(string), "https://") {
				t.Errorf("CreateAsset body = %#v", body)
			}
			f.mu.Lock()
			f.assetSeq++
			id := f.assetSeq
			f.mu.Unlock()
			_, _ = w.Write([]byte(`{"Result":{"Id":"asset-2026110` + string(rune('0'+id)) + `-portrait"}}`))
		case "GetAsset":
			_, _ = w.Write([]byte(`{"Result":{"Status":"` + status + `"}}`))
		case "DeleteAsset", "DeleteAssetGroup":
			_, _ = w.Write([]byte(`{"Result":{}}`))
		default:
			t.Errorf("unexpected action %s", action)
			w.WriteHeader(http.StatusBadRequest)
		}
	}
}

func (f *fakeArkPortraitControlPlane) state(t *testing.T) string {
	f.mu.Lock()
	defer f.mu.Unlock()
	parsed, err := url.Parse(f.callbackURL)
	if err != nil || !strings.HasPrefix(parsed.Path, "/api/ark-portraits/callback/") || parsed.RawQuery != "" {
		t.Fatalf("callback URL = %q", f.callbackURL)
	}
	return strings.TrimPrefix(parsed.Path, "/api/ark-portraits/callback/")
}

func (f *fakeArkPortraitControlPlane) setAssetStatus(status string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.assetStatus = status
}

func testPNG(t *testing.T, width, height int) []byte {
	t.Helper()
	canvas := image.NewRGBA(image.Rect(0, 0, width, height))
	canvas.Set(0, 0, color.RGBA{R: 255, A: 255})
	var buffer bytes.Buffer
	if err := png.Encode(&buffer, canvas); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}

func arkPortraitTestService(t *testing.T, mutate ...func(*arkPrivateAssetSettingValue)) (*Service, *gorm.DB, *fakeArkPortraitControlPlane) {
	t.Helper()
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	t.Setenv("CANVAS_PUBLIC_BASE_URL", "https://canvas.example.test")
	s, db, _, _ := creationTestService(t)
	fake := &fakeArkPortraitControlPlane{assetStatus: "Processing"}
	server := httptest.NewServer(fake.handler(t))
	t.Cleanup(server.Close)
	previous := arkPrivateAssetAPIBaseURLOverride
	arkPrivateAssetAPIBaseURLOverride = server.URL
	t.Cleanup(func() { arkPrivateAssetAPIBaseURLOverride = previous })

	setting := defaultArkPrivateAssetSetting()
	setting.RealEnabled, setting.VirtualEnabled = true, true
	setting.Site, setting.Region, setting.ProjectName = arkSiteVolcengine, "cn-beijing", "portrait-project"
	setting.AccessKeyID, setting.AccessKeySecret, setting.CallbackBaseURL = "ak", "sk", "https://canvas.example.test"
	for _, apply := range mutate {
		apply(&setting)
	}
	if err := s.saveArkPrivateAssetSetting(&model.SystemSetting{Key: arkPrivateAssetSettingKey}, setting); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(s.dataDir, "resources"), 0o700); err != nil {
		t.Fatal(err)
	}
	picture := testPNG(t, 400, 500)
	if err := os.WriteFile(filepath.Join(s.dataDir, "resources", "portrait.png"), picture, 0o600); err != nil {
		t.Fatal(err)
	}
	for _, row := range []any{
		&model.User{ID: "other", Username: "other", Role: model.UserRoleUser, Status: model.UserStatusActive},
		&model.User{ID: "admin", Username: "admin", Role: model.UserRoleAdmin, Status: model.UserStatusActive},
		&model.Resource{ID: "portrait-res", UserID: "user", Kind: "image", Status: model.ResourceStatusReady, Provider: "local", ObjectKey: "portrait.png", MimeType: "image/png", Size: int64(len(picture)), Width: 400, Height: 500},
		&model.Resource{ID: "other-res", UserID: "other", Kind: "image", Status: model.ResourceStatusReady, Provider: "local", ObjectKey: "portrait.png", MimeType: "image/png", Size: int64(len(picture)), Width: 400, Height: 500},
		&model.Resource{ID: "admin-res", UserID: "admin", Kind: "image", Status: model.ResourceStatusReady, Provider: "local", ObjectKey: "portrait.png", MimeType: "image/png", Size: int64(len(picture)), Width: 400, Height: 500},
	} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	return s, db, fake
}

func arkTestBalance(t *testing.T, db *gorm.DB, userID string) model.CreditAccount {
	t.Helper()
	var account model.CreditAccount
	if err := db.First(&account, "user_id = ?", userID).Error; err != nil {
		t.Fatal(err)
	}
	return account
}

func arkTestReference(id string) *canvasGenerationInput {
	return &canvasGenerationInput{Mode: "video", ReferenceImages: []providerMedia{{URL: "asset://" + id}}}
}

// 本站直扣：下单即从可用余额扣除，不冻结

func TestArkPortraitSessionFailureExpiryAndCancelRefund(t *testing.T) {
	s, db, fake := arkPortraitTestService(t, func(value *arkPrivateAssetSettingValue) {
		value.BillingEnabled, value.RealGroupPriceMicrocredits = true, CreditScale
	})
	ctx := context.Background()
	user := &model.User{ID: "user", Role: model.UserRoleUser}
	if err := db.Model(&model.CreditAccount{}).Where("user_id = ?", "user").Update("available_microcredits", 3*CreditScale).Error; err != nil {
		t.Fatal(err)
	}

	failed, err := s.CreateArkPortraitSession(ctx, user, "演员乙", "zh-CN")
	if err != nil {
		t.Fatal(err)
	}
	if got := s.HandleArkPortraitCallback(ctx, fake.state(t), url.Values{"resultCode": {"20001"}, "algorithmBaseRespCode": {"5"}}); got != "/ark-portrait/result?status=failed" {
		t.Fatalf("failed redirect = %q", got)
	}
	view, err := s.CheckArkPortraitSession(ctx, user, failed.ID)
	if err != nil || view.Status != arkPortraitSessionFailed || !strings.Contains(view.Error, "20001") {
		t.Fatalf("failed session = %#v, %v", view, err)
	}

	cancelled, err := s.CreateArkPortraitSession(ctx, user, "演员丙", "zh-Hant")
	if err != nil {
		t.Fatal(err)
	}
	if link, _ := url.Parse(cancelled.H5Link); link.Query().Get("lng") != "zh-Hant" {
		t.Fatalf("h5 link = %q", cancelled.H5Link)
	}
	if _, err := s.CancelArkPortraitSession(&model.User{ID: "other"}, cancelled.ID); err == nil {
		t.Fatal("other user must not cancel the session")
	}
	if view, err := s.CancelArkPortraitSession(user, cancelled.ID); err != nil || view.Status != arkPortraitSessionCancelled {
		t.Fatalf("cancelled session = %#v, %v", view, err)
	}

	expiring, err := s.CreateArkPortraitSession(ctx, user, "演员丁", "zh")
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.ArkPortraitSession{}).Where("id = ?", expiring.ID).Update("expires_at", time.Now().Add(-time.Minute)).Error; err != nil {
		t.Fatal(err)
	}
	s.runArkPortraitMaintenance(ctx)
	if view, err := s.ArkPortraitSessionStatus(user, expiring.ID); err != nil || view.Status != arkPortraitSessionExpired {
		t.Fatalf("expired session = %#v, %v", view, err)
	}
	if account := arkTestBalance(t, db, "user"); account.AvailableMicrocredits != 3*CreditScale || account.ReservedMicrocredits != 0 {
		t.Fatalf("all failed sessions must be refunded: %#v", account)
	}
	var refunds int64
	if err := db.Model(&model.CreditLedgerEntry{}).Where("user_id = ? AND type = ? AND scene = ?", "user", model.CreditLedgerRefund, model.BillingSceneArkAssetGroup).Count(&refunds).Error; err != nil || refunds != 3 {
		t.Fatalf("refund entries = %d, %v", refunds, err)
	}

	pending, err := s.CreateArkPortraitSession(ctx, user, "演员戊", "zh")
	if err != nil {
		t.Fatal(err)
	}
	if view, err := s.CheckArkPortraitSession(ctx, user, pending.ID); err != nil || view.Status != arkPortraitSessionVerified || view.GroupID != "group-20261104-abcde" {
		t.Fatalf("polled session = %#v, %v", view, err)
	}
	if got := s.HandleArkPortraitCallback(ctx, "not-a-valid-state", url.Values{}); got != "/ark-portrait/result?status=invalid" {
		t.Fatalf("invalid state redirect = %q", got)
	}
}

func TestArkVirtualGroupRefundsWhenCreationFailsAndRespectsLimit(t *testing.T) {
	s, db, fake := arkPortraitTestService(t, func(value *arkPrivateAssetSettingValue) {
		value.BillingEnabled, value.VirtualGroupPriceMicrocredits, value.VirtualGroupLimit, value.VirtualReviewRequired = true, 2*CreditScale, 1, false
	})
	ctx := context.Background()
	user := &model.User{ID: "user", Role: model.UserRoleUser}
	if _, err := s.CreateArkVirtualGroup(ctx, user, ArkGroupInput{Name: "二次元少女"}); err == nil || !strings.Contains(err.Error(), "积分不足") {
		t.Fatalf("virtual group without credits = %v", err)
	}
	if err := db.Model(&model.CreditAccount{}).Where("user_id = ?", "user").Update("available_microcredits", 5*CreditScale).Error; err != nil {
		t.Fatal(err)
	}
	group, err := s.CreateArkVirtualGroup(ctx, user, ArkGroupInput{Name: "二次元少女", Description: "主角立绘"})
	if err != nil {
		t.Fatal(err)
	}
	if group.Kind != arkGroupKindVirtual || group.Source != arkGroupSourceCreated || group.ExpiresAt != nil || group.ExpiryStatus != "none" {
		t.Fatalf("virtual group = %#v", group)
	}
	if account := arkTestBalance(t, db, "user"); account.AvailableMicrocredits != 3*CreditScale || account.ReservedMicrocredits != 0 {
		t.Fatalf("virtual group charge = %#v", account)
	}
	if _, err := s.CreateArkVirtualGroup(ctx, user, ArkGroupInput{Name: "第二组"}); err == nil || !strings.Contains(err.Error(), "最多创建 1 个") {
		t.Fatalf("virtual group limit = %v", err)
	}
	asset, err := s.CreateArkPortraitAsset(ctx, user, group.ID, ArkAssetUploadInput{ResourceID: "portrait-res", Name: "立绘"})
	if err != nil || asset.Status != arkPortraitAssetProcessing {
		t.Fatalf("review-free upload = %#v, %v", asset, err)
	}
	fake.setAssetStatus("Active")
	refreshed, err := s.RefreshArkPortraitAsset(ctx, user, asset.ID)
	if err != nil || refreshed.Status != arkPortraitAssetActive || !refreshed.InLibrary || refreshed.LibraryAssetID != arkOwnLibraryAssetID(asset.ID) {
		t.Fatalf("refreshed asset = %#v, %v", refreshed, err)
	}
	var created model.Asset
	if err := db.First(&created, "id = ? AND user_id = ?", arkOwnLibraryAssetID(asset.ID), "user").Error; err != nil || created.Category != model.AssetCategoryArk || !strings.Contains(created.PayloadJSON, `"kind":"virtual"`) {
		t.Fatalf("auto library asset = %#v, %v", created, err)
	}
}

func TestArkPortraitDisabledOverview(t *testing.T) {
	s, _, _, _ := creationTestService(t)
	overview, err := s.ArkPortraitOverview(context.Background(), &model.User{ID: "user"})
	if err != nil || overview.Enabled || overview.Groups == nil {
		t.Fatalf("overview = %#v, %v", overview, err)
	}
	if _, err := s.CreateArkPortraitSession(context.Background(), &model.User{ID: "user"}, "演员", "zh"); err == nil {
		t.Fatal("unconfigured portrait library must reject new sessions")
	}
}

func TestArkPortraitH5LanguageMapping(t *testing.T) {
	for input, want := range map[string]string{"": "zh", "zh-CN": "zh", "zh-TW": "zh-Hant", "zh-Hant": "zh-Hant", "en": "en", "ja-JP": "en", "fr": "en"} {
		if got := arkPortraitH5Language(input); got != want {
			t.Fatalf("arkPortraitH5Language(%q) = %q, want %q", input, got, want)
		}
	}
	if _, err := arkPortraitH5Link("http://insecure.example/h5", "zh"); err == nil {
		t.Fatal("non-https h5 link must be rejected")
	}
}
