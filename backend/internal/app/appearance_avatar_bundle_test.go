package app

import (
	"archive/zip"
	"bytes"
	"reflect"
	"testing"
)

func agentAvatarBundleTestZIP(t *testing.T, manifest string, files map[string][]byte) []byte {
	t.Helper()
	var data bytes.Buffer
	w := zip.NewWriter(&data)
	if manifest != "" {
		file, err := w.Create("avatar.json")
		if err != nil {
			t.Fatal(err)
		}
		if _, err := file.Write([]byte(manifest)); err != nil {
			t.Fatal(err)
		}
	}
	for name, content := range files {
		file, err := w.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := file.Write(content); err != nil {
			t.Fatal(err)
		}
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	return data.Bytes()
}

func agentAvatarTestMP4() []byte {
	return []byte{0, 0, 0, 16, 'f', 't', 'y', 'p', 'i', 's', 'o', 'm', 0, 0, 0, 0}
}

func TestAgentAvatarBundleArchiveValidation(t *testing.T) {
	validManifest := `{"version":1,"width":480,"height":432,"clips":{"idle":"idle.mp4","wave":"wave.mp4"}}`
	validFiles := map[string][]byte{"idle.mp4": agentAvatarTestMP4(), "wave.mp4": agentAvatarTestMP4()}
	data := agentAvatarBundleTestZIP(t, validManifest, validFiles)
	manifest, err := validateAgentAvatarBundleArchive(bytes.NewReader(data), int64(len(data)))
	if err != nil || manifest.Width != 480 || manifest.Height != 432 || len(manifest.Clips) != 2 {
		t.Fatalf("valid bundle rejected: manifest=%+v err=%v", manifest, err)
	}

	tests := []struct {
		name     string
		manifest string
		files    map[string][]byte
	}{
		{"missing manifest", "", validFiles},
		{"unsupported version", `{"version":2,"width":480,"height":432,"clips":{"idle":"idle.mp4"}}`, map[string][]byte{"idle.mp4": agentAvatarTestMP4()}},
		{"path traversal", `{"version":1,"width":480,"height":432,"clips":{"idle":"../idle.mp4"}}`, map[string][]byte{"../idle.mp4": agentAvatarTestMP4()}},
		{"missing clip", `{"version":1,"width":480,"height":432,"clips":{"idle":"idle.mp4"}}`, nil},
		{"invalid mp4", `{"version":1,"width":480,"height":432,"clips":{"idle":"idle.mp4"}}`, map[string][]byte{"idle.mp4": []byte("not an mp4 file")}},
		{"unreferenced file", `{"version":1,"width":480,"height":432,"clips":{"idle":"idle.mp4"}}`, map[string][]byte{"idle.mp4": agentAvatarTestMP4(), "extra.mp4": agentAvatarTestMP4()}},
		{"unsupported file", `{"version":1,"width":480,"height":432,"clips":{"idle":"idle.mp4"}}`, map[string][]byte{"idle.mp4": agentAvatarTestMP4(), "readme.txt": []byte("not allowed")}},
		{"invalid dimensions", `{"version":1,"width":0,"height":432,"clips":{"idle":"idle.mp4"}}`, map[string][]byte{"idle.mp4": agentAvatarTestMP4()}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			data := agentAvatarBundleTestZIP(t, test.manifest, test.files)
			if _, err := validateAgentAvatarBundleArchive(bytes.NewReader(data), int64(len(data))); err == nil {
				t.Fatal("invalid bundle accepted")
			}
		})
	}
}

func TestDefaultCanvasAppearanceKeepsLocalOrbAndSupportsBuiltInAvatarBundle(t *testing.T) {
	value := defaultCanvasAppearance()
	if value.AvatarType != "orb" || value.AvatarBundleResourceID != "" {
		t.Fatalf("default canvas appearance = %+v, want local orb avatar", value)
	}
	value.AvatarType = "bundle"
	wantStates := map[string]string{
		"idle": "idle", "queued": "sleep_loop", "running": "working_loop", "waiting_approval": "think",
		"completed": "wave", "failed": "wipe_sweat", "cancelled": "lie_down", "rejected": "think",
	}
	value.AvatarClipStates = wantStates
	normalized, err := normalizeCanvasAppearance(value)
	if err != nil {
		t.Fatalf("default bundle rejected: %v", err)
	}
	if !reflect.DeepEqual(normalized.AvatarClipStates, wantStates) {
		t.Fatalf("bundle clip mapping = %#v", normalized.AvatarClipStates)
	}
	invalid := value
	invalid.AvatarClipStates = map[string]string{"unrecognized": "idle"}
	if _, err := normalizeCanvasAppearance(invalid); err == nil {
		t.Fatal("unknown state accepted")
	}
}
