package app

import (
	"bytes"
	"encoding/json"
	"image"
	"image/color"
	"image/png"
	"strings"
	"testing"

	"yingce/backend/internal/model"
)

func TestEcommerceDetailLayoutExecutionUsesEveryReference(t *testing.T) {
	s, db, req := executionFixture(t)
	req.Progressive = true
	req.Draft = EcommerceDraft{Platform: "taobao", ImageType: "detail", Count: 3, Language: "fr-FR", Ratio: "1:1", Resolution: "1k", ImageModel: "gpt-image-1", ReferenceMode: "layout"}
	if _, err := s.StartEcommerceExecution("user", req); err == nil {
		t.Fatal("layout execution accepted a draft without either image group")
	}

	profile := DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceChatCompletion), "text-test")
	profile.Text.References.MaxImages = 3
	if err := db.Model(&model.ChannelModel{}).Where("id = ?", "cm").Update("capability_config_json", mustEncodeModelCapabilityConfig(t, profile)).Error; err != nil {
		t.Fatal(err)
	}
	ids := make([]string, 3)
	for index := range ids {
		var data bytes.Buffer
		img := image.NewRGBA(image.Rect(0, 0, 24, 24))
		img.SetRGBA(0, 0, color.RGBA{R: uint8(index + 1), A: 255})
		if err := png.Encode(&data, img); err != nil {
			t.Fatal(err)
		}
		resource, err := s.UploadResourceFile("user", "photo.png", int64(data.Len()), "image", 24, 24, 0, bytes.NewReader(data.Bytes()), "")
		if err != nil {
			t.Fatal(err)
		}
		ids[index] = resource.ID
	}
	req.Draft.References = []EcommerceReference{{ResourceID: ids[0], Role: "primary"}}
	if _, err := s.StartEcommerceExecution("user", req); err == nil {
		t.Fatal("layout execution accepted a product image without a layout")
	}
	req.Draft.LayoutReferences = []EcommerceReference{{ResourceID: ids[1], Role: "style"}, {ResourceID: ids[2], Role: "style"}}
	project, err := s.StartEcommerceExecution("user", req)
	if err != nil {
		t.Fatal(err)
	}
	project = executionAdvance(t, s, project.ID)
	plannerID := executionDraft(t, project).PlanningTaskID
	planner, err := s.repo.TaskForUser("user", plannerID)
	if err != nil {
		t.Fatal(err)
	}
	var input canvasGenerationInput
	if err := json.Unmarshal([]byte(planner.InputJSON), &input); err != nil {
		t.Fatal(err)
	}
	if len(input.ReferenceImages) != len(ids) || !strings.Contains(planner.Prompt, "referenceObservations") {
		t.Fatalf("planner lacks full layout inputs: got %d reference(s)", len(input.ReferenceImages))
	}
	if err := s.hydrateGenerationMedia("user", &input, providerMediaHydrationPolicy{}); err != nil {
		t.Fatal(err)
	}
	for index, ref := range input.ReferenceImages {
		if ref.StorageKey != "resource:"+ids[index] || !strings.HasPrefix(ref.DataURL, "data:image/png;base64,") {
			t.Fatalf("planner input %d was not hydrated from the ordered uploaded resource", index+1)
		}
	}

	plan := model.EcommercePlan{
		ProductSummary: "真实商品", VisualStrategy: "依序沿用参考构图", ConfirmedFacts: []string{}, UncertainFacts: []string{}, QualityChecks: []string{},
		ReferenceSummary: "读取了两张原图",
		ReferenceObservations: []model.EcommerceLayoutObservation{
			{ResourceID: ids[1], Layout: "左侧标题、右侧商品", Visual: "浅色背景"},
			{ResourceID: ids[2], Layout: "上部标题、下部商品", Visual: "暗色背景"},
		},
	}
	for _, id := range []string{"image-1", "image-2", "image-3"} {
		plan.Images = append(plan.Images, model.EcommercePlanTask{ID: id, ImageType: "detail", Language: "zh-CN", Goal: "展示商品", Theme: "商品照片", Composition: "商品居中", MainVisual: "真实商品", Fidelity: "保真", Prompt: "拍摄真实商品", Copy: "Un objet pour le quotidien", Ratio: "3:4", Resolution: "4k", PerformanceAngle: "可见设计｜展示图片里可见的外形", InformationComponent: "标题导语｜标题放在画面留白处，商品主体位置不受遮挡"})
	}
	missing := plan
	missing.ReferenceObservations = plan.ReferenceObservations[:1]
	raw, _ := json.Marshal(missing)
	if err := s.validateEcommerceWorkbenchResult("user", input, map[string]any{"text": string(raw)}); err == nil {
		t.Fatal("analysis omitting a layout was accepted")
	}
	raw, _ = json.Marshal(plan)
	modelResult := map[string]any{"text": string(raw)}
	if err := s.validateEcommerceWorkbenchResult("user", input, modelResult); err != nil {
		t.Fatal(err)
	}
	result, _ := json.Marshal(modelResult)
	if err := db.Model(&model.Task{}).Where("id = ?", plannerID).Updates(map[string]any{"status": model.TaskStatusSucceeded, "result_json": string(result)}).Error; err != nil {
		t.Fatal(err)
	}
	project = executionAdvance(t, s, project.ID)
	for range req.Draft.Count {
		project = executionAdvance(t, s, project.ID)
	}
	if err := json.Unmarshal([]byte(project.PlanJSON), &plan); err != nil {
		t.Fatal(err)
	}
	for index, page := range plan.Images {
		want := ids[1+index%2]
		if page.LayoutReferenceID != want || page.Language != "fr-FR" || page.Ratio != "1:1" || page.Resolution != "1k" {
			t.Fatalf("image %d did not retain assigned layout, language, ratio, and resolution", index+1)
		}
		task, err := s.repo.TaskForUser("user", page.TaskID)
		if err != nil {
			t.Fatal(err)
		}
		var imageInput canvasGenerationInput
		if err := json.Unmarshal([]byte(task.InputJSON), &imageInput); err != nil {
			t.Fatal(err)
		}
		if len(imageInput.ReferenceImages) != 2 || imageInput.ReferenceImages[0].StorageKey != "resource:"+ids[0] || imageInput.ReferenceImages[1].StorageKey != "resource:"+want {
			t.Fatalf("image %d did not receive product pixels followed by its assigned original layout", index+1)
		}
		if !strings.Contains(task.Prompt, "最后一张附图是版式参考") || !strings.Contains(task.Prompt, "fr-FR") {
			t.Fatalf("image %d is missing its visual and language instructions", index+1)
		}
	}
}
