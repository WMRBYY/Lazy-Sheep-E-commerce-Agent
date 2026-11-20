package app

import (
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"yingce/backend/internal/model"
)

func TestEcommerceDetailProductRecognitionSendsOwnedImagePixels(t *testing.T) {
	svc, db := mockEcommerceAgentService(t)
	resourceDir := filepath.Join(svc.dataDir, "resources")
	if err := os.MkdirAll(resourceDir, 0700); err != nil {
		t.Fatal(err)
	}
	const encoded = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/N3sAAAAASUVORK5CYII="
	data, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		t.Fatal(err)
	}
	id := "product"
	if err := os.WriteFile(filepath.Join(resourceDir, id+".png"), data, 0600); err != nil {
		t.Fatal(err)
	}
	image := model.Resource{ID: id, UserID: "owner", Kind: "image", Status: model.ResourceStatusReady, MimeType: "image/png", Provider: "local", ObjectKey: id + ".png", Size: int64(len(data))}
	if err := db.Create(&image).Error; err != nil {
		t.Fatal(err)
	}
	input := map[string]any{
		"mode":            "text",
		"metadata":        map[string]any{"source": "ecommerce-agent", "stage": ecommerceDetailProductRecognitionStage},
		"referenceImages": []any{map[string]any{"storageKey": "resource:" + id, "url": "https://example.com/never-use.png"}},
		"referenceVideos": []any{map[string]any{"storageKey": "resource:video"}},
		"agentRequests":   map[string]any{},
	}
	if err := svc.requireTaskGenerationFeatures("owner", "", "canvas_text", "text", "", input); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.prepareEcommerceWorkbenchTask("another-user", input, "replace the prompt"); err == nil {
		t.Fatal("another user admitted with someone else's image")
	}
	if _, err := svc.prepareEcommerceWorkbenchTask("owner", input, "replace the prompt"); err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(input)
	if err != nil {
		t.Fatal(err)
	}
	var providerInput canvasGenerationInput
	if err := json.Unmarshal(raw, &providerInput); err != nil {
		t.Fatal(err)
	}
	if providerInput.Prompt != ecommerceDetailProductRecognitionPrompt || len(providerInput.ReferenceVideos) != 0 || providerInput.AgentRequests != nil {
		t.Fatalf("recognition task didn't use the dedicated prompt and image-only inputs: %+v", providerInput)
	}
	if err := svc.hydrateGenerationMedia("owner", &providerInput, providerMediaHydrationPolicy{}); err != nil {
		t.Fatal(err)
	}
	content, err := textChatContent(providerInput)
	if err != nil {
		t.Fatal(err)
	}
	if blocks, ok := content.([]map[string]any); !ok || len(blocks) != 2 || blocks[1]["image_url"].(map[string]any)["url"] != "data:image/png;base64,"+encoded {
		t.Fatalf("vision input did not contain the actual uploaded pixels: %v", content)
	}
	if err := os.Remove(filepath.Join(resourceDir, id+".png")); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.prepareEcommerceWorkbenchTask("owner", input, "analyze"); err == nil {
		t.Fatal("unreadable image admitted for billing")
	}
}

func TestEcommerceDetailProductRecognitionRefusesEmptyResults(t *testing.T) {
	result := map[string]any{"text": `{"productName":"","category":"","claims":"便携"}`}
	if err := validateEcommerceDetailProductRecognition(result); err == nil {
		t.Fatal("unrecognized image was treated as success")
	}
	result["text"] = "```json\n{\"category\":\"风扇\",\"claims\":\"带手柄\\n可折叠\",\"referenceInstructions\":\"ignored\"}\n```"
	if err := validateEcommerceDetailProductRecognition(result); err != nil {
		t.Fatal(err)
	}
	text := stringValue(result["text"])
	if !strings.Contains(text, "\"claims\":\"带手柄\\n可折叠\"") || strings.Contains(text, "referenceInstructions") {
		t.Fatalf("unexpected recognition output: %s", text)
	}
}
