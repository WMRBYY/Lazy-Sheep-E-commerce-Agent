package app

import (
	"bytes"
	"encoding/json"
	"math"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/textproto"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"testing"

	"yingce/backend/internal/database"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestAppearanceBundledSkinsRespectLibraryLimit(t *testing.T) {
	existing := []AppearanceSkinTheme{defaultClassicAppearanceSkin()}
	for index := 1; index < maxAppearanceSkinThemes-1; index++ {
		existing = append(existing, cloneAppearanceSkin(existing[0], "custom-"+strconv.Itoa(index), "自定义皮肤", ""))
	}
	got := appendMissingAppearanceThemePackSkins(slices.Clone(existing))
	if len(got) != maxAppearanceSkinThemes || !slices.Equal(got[:len(existing)], existing) || got[len(existing)].ID != "longying-ink" {
		t.Fatal("only the available library slot may be used")
	}
	if !slices.Equal(appendMissingAppearanceThemePackSkins(slices.Clone(got)), got) {
		t.Fatal("a full library must stay intact")
	}
}

func TestBuiltInAppearanceSkinAuthPalettesFollowMode(t *testing.T) {
	for _, skin := range defaultAppearanceSkinThemes() {
		if skin.Tokens.Light.AuthBackground == skin.Tokens.Dark.AuthBackground || skin.Tokens.Light.AuthCard == skin.Tokens.Dark.AuthCard {
			t.Errorf("skin %s reuses dark auth surfaces in light mode", skin.ID)
		}
		for _, mode := range []struct {
			name   string
			tokens AppearanceSkinModeTokens
		}{
			{name: "light", tokens: skin.Tokens.Light},
			{name: "dark", tokens: skin.Tokens.Dark},
		} {
			for label, foreground := range map[string]string{"text": mode.tokens.Text, "muted": mode.tokens.AuthMuted, "accent": mode.tokens.AuthAccent} {
				if ratio := appearanceColorContrastRatio(t, foreground, mode.tokens.AuthCard); ratio < 4.5 {
					t.Errorf("skin %s %s auth %s contrast = %.2f, want at least 4.5", skin.ID, mode.name, label, ratio)
				}
			}
		}
	}
}

func TestBuiltInAppearanceSkinTooltipPairsMeetContrast(t *testing.T) {
	for _, skin := range defaultAppearanceSkinThemes() {
		modes := []struct {
			name   string
			tokens AppearanceSkinModeTokens
		}{
			{name: "light", tokens: skin.Tokens.Light},
			{name: "dark", tokens: skin.Tokens.Dark},
		}
		for _, mode := range modes {
			ratio := appearanceColorContrastRatio(t, mode.tokens.Overlay, mode.tokens.Text)
			if ratio < 4.5 {
				t.Errorf("skin %s %s tooltip contrast = %.2f, want at least 4.5", skin.ID, mode.name, ratio)
			}
		}
	}
}

func appearanceColorContrastRatio(t *testing.T, foreground, background string) float64 {
	t.Helper()
	contrastLuminance := func(color string) float64 {
		if len(color) != 7 || color[0] != '#' {
			t.Fatalf("unsupported test color %q", color)
		}
		channels := make([]float64, 3)
		for index := range channels {
			value, err := strconv.ParseUint(color[1+index*2:3+index*2], 16, 8)
			if err != nil {
				t.Fatalf("parse test color %q: %v", color, err)
			}
			srgb := float64(value) / 255
			if srgb <= 0.04045 {
				channels[index] = srgb / 12.92
			} else {
				channels[index] = math.Pow((srgb+0.055)/1.055, 2.4)
			}
		}
		return 0.2126*channels[0] + 0.7152*channels[1] + 0.0722*channels[2]
	}
	foregroundLuminance := contrastLuminance(foreground)
	backgroundLuminance := contrastLuminance(background)
	lighter := math.Max(foregroundLuminance, backgroundLuminance)
	darker := math.Min(foregroundLuminance, backgroundLuminance)
	return (lighter + 0.05) / (darker + 0.05)
}

func TestAppearanceBackfillsVersionSevenFieldsForExistingSetting(t *testing.T) {
	svc, db, _, _ := newAppearanceTestService(t)
	legacy := model.SystemSetting{Key: appearanceSettingKey, ValueJSON: `{"schemaVersion":1,"brandName":"旧品牌","skinId":"classic"}`}
	if err := db.Create(&legacy).Error; err != nil {
		t.Fatal(err)
	}

	appearance, err := svc.Appearance()
	if err != nil {
		t.Fatal(err)
	}
	if appearance.SchemaVersion != appearanceSchemaVersion || appearance.BrandName != "旧品牌" || appearance.BrandSlug != defaultAppearanceBrandSlug || appearance.AuthHeroTitle != defaultAppearanceHeroTitle || appearance.AuthHeroDescription != "" || appearance.DarkLogoURL != defaultAppearanceLogoURL || !appearance.LogoFrameEnabled || !appearance.AuthVideoAutoplay || appearance.SEOTitle != "旧品牌" || !strings.Contains(appearance.SEODescription, "旧品牌") || !strings.Contains(appearance.FooterCopyright, "旧品牌") || appearance.ActiveSkin.ID != "classic" {
		t.Fatalf("legacy appearance = %#v", appearance)
	}
}

func TestAppearanceFallsBackWhenLocalLogoFileIsMissing(t *testing.T) {
	svc, db, _, _ := newAppearanceTestService(t)
	resource := model.Resource{ID: "missing-local-logo", UserID: "appearance-admin", Kind: "image", Status: model.ResourceStatusReady, Provider: "local", ObjectKey: "brand/missing.png", MimeType: "image/png"}
	if err := db.Create(&resource).Error; err != nil {
		t.Fatal(err)
	}
	value := defaultAppearanceSetting()
	value.LogoResourceID = resource.ID
	encoded, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.SystemSetting{Key: appearanceSettingKey, ValueJSON: string(encoded)}).Error; err != nil {
		t.Fatal(err)
	}

	appearance, err := svc.Appearance()
	if err != nil {
		t.Fatal(err)
	}
	if appearance.LogoConfigured || appearance.LogoURL != defaultAppearanceLogoURL {
		t.Fatalf("missing local logo public appearance = %#v", appearance)
	}
}

func TestValidateAppearanceUploadSniffsBytesInsteadOfDeclaredMIME(t *testing.T) {
	pngHeader := multipartFileHeader(t, "logo.png", "text/plain", append([]byte{0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a}, bytes.Repeat([]byte{0}, 32)...))
	if mimeType, err := validateAppearanceUpload(AppearanceAssetLogo, pngHeader); err != nil || mimeType != "image/png" {
		t.Fatalf("validateAppearanceUpload(png) = %q, %v", mimeType, err)
	}
	darkPNGHeader := multipartFileHeader(t, "logo-dark.png", "text/plain", append([]byte{0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a}, bytes.Repeat([]byte{0}, 32)...))
	if mimeType, err := validateAppearanceUpload(AppearanceAssetDarkLogo, darkPNGHeader); err != nil || mimeType != "image/png" {
		t.Fatalf("validateAppearanceUpload(dark png) = %q, %v", mimeType, err)
	}
	fakeImage := multipartFileHeader(t, "fake.png", "image/png", []byte("not an image"))
	if _, err := validateAppearanceUpload(AppearanceAssetLogo, fakeImage); err == nil {
		t.Fatal("declared image MIME accepted non-image bytes")
	}
	mp4Bytes := append([]byte{0x00, 0x00, 0x00, 0x14}, []byte("ftypisom\x00\x00\x00\x00isom")...)
	mp4Header := multipartFileHeader(t, "hero.mp4", "application/octet-stream", mp4Bytes)
	if mimeType, err := validateAppearanceUpload(AppearanceAssetVideo, mp4Header); err != nil || mimeType != "video/mp4" {
		t.Fatalf("validateAppearanceUpload(mp4) = %q, %v", mimeType, err)
	}
	fakeMP4 := multipartFileHeader(t, "fake.mp4", "video/mp4", append([]byte{0x00, 0x00, 0x10, 0x00}, []byte("ftypisom")...))
	if _, err := validateAppearanceUpload(AppearanceAssetVideo, fakeMP4); err == nil {
		t.Fatal("invalid MP4 box size accepted")
	}
}

func multipartFileHeader(t *testing.T, name string, contentType string, data []byte) *multipart.FileHeader {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	header := make(textproto.MIMEHeader)
	header.Set("Content-Disposition", `form-data; name="file"; filename="`+name+`"`)
	header.Set("Content-Type", contentType)
	part, err := writer.CreatePart(header)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := part.Write(data); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPost, "/", &body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	if err := req.ParseMultipartForm(int64(body.Len()) + 1024); err != nil {
		t.Fatal(err)
	}
	return req.MultipartForm.File["file"][0]
}

func writeAppearanceResourceFixtures(t *testing.T, dataDir string, resources []model.Resource) {
	t.Helper()
	for _, resource := range resources {
		if resource.Provider != "local" {
			continue
		}
		filePath := filepath.Join(dataDir, "resources", filepath.FromSlash(resource.ObjectKey))
		if err := os.MkdirAll(filepath.Dir(filePath), 0o750); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filePath, []byte(resource.ID), 0o640); err != nil {
			t.Fatal(err)
		}
	}
}

func newAppearanceTestService(t *testing.T) (*Service, *gorm.DB, string, *model.User) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+newID()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := database.MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	admin := &model.User{ID: "appearance-admin", Username: "appearance-admin", Role: model.UserRoleAdmin, Status: model.UserStatusActive}
	if err := db.Create(admin).Error; err != nil {
		t.Fatal(err)
	}
	dataDir := t.TempDir()
	return New(repository.New(db), dataDir), db, dataDir, admin
}
