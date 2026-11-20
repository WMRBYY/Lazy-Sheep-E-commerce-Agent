package app

import (
	"testing"
)

func updateTestValue() UpdateAnnouncement {
	return UpdateAnnouncement{Enabled: true, CurrentVersion: "v2.0", Releases: []UpdateRelease{{ID: "release-1", Version: "v2.0", Title: "更新公告", Blocks: []UpdateBlock{{ID: "text-1", Type: "text", Text: "新增功能", Layout: "full"}}}}}
}

func TestUpdateAnnouncementValidation(t *testing.T) {
	cases := []struct {
		name   string
		mutate func(*UpdateAnnouncement)
	}{
		{"empty", func(v *UpdateAnnouncement) { v.Releases = nil }},
		{"version mismatch", func(v *UpdateAnnouncement) { v.CurrentVersion = "other" }},
		{"duplicate id", func(v *UpdateAnnouncement) { v.Releases[0].Blocks[0].ID = "release-1" }},
		{"duplicate version", func(v *UpdateAnnouncement) {
			v.Releases = append(v.Releases, UpdateRelease{ID: "release-2", Version: "v2.0"})
		}},
		{"blank text", func(v *UpdateAnnouncement) { v.Releases[0].Blocks[0].Text = " " }},
		{"unknown type", func(v *UpdateAnnouncement) { v.Releases[0].Blocks[0].Type = "html" }},
		{"unknown layout", func(v *UpdateAnnouncement) { v.Releases[0].Blocks[0].Layout = "script" }},
		{"missing media", func(v *UpdateAnnouncement) { v.Releases[0].Blocks[0].Type = "video" }},
		{"invalid date", func(v *UpdateAnnouncement) { v.Releases[0].Date = "2026-02-30" }},
		{"control characters", func(v *UpdateAnnouncement) { v.CurrentVersion = "v\x00bad" }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			v := updateTestValue()
			tc.mutate(&v)
			if _, err := normalizeUpdateAnnouncement(v); err == nil {
				t.Fatal("invalid input accepted")
			}
		})
	}
	value := updateTestValue()
	value.Releases[0].Blocks[0].MediaURL = "javascript:alert(1)"
	clean, err := normalizeUpdateAnnouncement(value)
	if err != nil || clean.Releases[0].Blocks[0].MediaURL != "" {
		t.Fatal("client media URL retained")
	}
}

func TestUpdateAnnouncementUploadTypesAndSizes(t *testing.T) {
	for _, slot := range []string{AppearanceAssetUpdateImage, AppearanceAssetUpdateVideo} {
		max, err := AppearanceAssetMaxBytes(slot)
		if err != nil {
			t.Fatal(err)
		}
		if slot == AppearanceAssetUpdateImage && max != 10<<20 || slot == AppearanceAssetUpdateVideo && max != 256<<20 {
			t.Fatalf("limit %s %d", slot, max)
		}
		fake := multipartFileHeader(t, "fake.png", "image/png", []byte("not media"))
		if _, err := validateAppearanceUpload(slot, fake); err == nil {
			t.Fatal("fake media accepted")
		}
	}
}
