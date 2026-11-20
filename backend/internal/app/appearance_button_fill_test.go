package app

import (
	"encoding/json"
	"testing"
)

func TestAppearanceLegacyButtonFills(t *testing.T) {
	themes := defaultAppearanceSkinThemes()
	for index := range themes {
		themes[index].Tokens.Buttons = AppearanceSkinButtons{}
	}
	migrated := normalizeAppearanceSkinThemes(themes)
	if err := validateAppearanceSkinThemes(migrated, "classic"); err != nil {
		t.Fatal(err)
	}
	// 经典与内置皮肤都回到纯色墨主按钮；渐变只在管理员显式开启后出现。
	for _, skin := range migrated {
		if skin.Tokens.Buttons.Light.Mode != "solid" || skin.Tokens.Buttons.Dark.Mode != "solid" {
			t.Fatalf("wrong fill for %s", skin.ID)
		}
	}
	var fill AppearanceSkinButtonFill
	if err := json.Unmarshal([]byte(`{"angle":1.5}`), &fill); err == nil {
		t.Fatal("fractional angle accepted")
	}
}
