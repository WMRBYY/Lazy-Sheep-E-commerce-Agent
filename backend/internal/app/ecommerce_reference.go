package app

import (
	"fmt"
	"io"
	"math"
	"slices"
	"strings"

	"yingce/backend/internal/model"
)

func (s *Service) ecommerceReadablePhoto(userID, resourceID string) (*model.Resource, error) {
	resource, err := s.repo.ResourceForUser(userID, resourceID)
	if err != nil || resource.Kind != "image" || resource.Status != model.ResourceStatusReady || !strings.HasPrefix(strings.ToLower(resource.MimeType), "image/") {
		return nil, BadAuthRequest("商品图或参考图无法读取，请重新上传")
	}
	stream, err := s.openResourceRange(userID, resource, "bytes=0-0")
	if err != nil {
		return nil, BadAuthRequest("商品图或参考图无法读取，请重新上传")
	}
	defer stream.Body.Close()
	var first [1]byte
	if _, err := io.ReadFull(stream.Body, first[:]); err != nil {
		return nil, BadAuthRequest("商品图或参考图无法读取，请重新上传")
	}
	return resource, nil
}

func isEcommerceLayoutRole(role string) bool {
	return role == "style" || role == "competitor"
}

// A nil group identifies an older request. Only an explicitly selected legacy
// source, or old style/competitor entries, can participate in that compatibility path.
func ecommerceLayoutSources(draft EcommerceDraft) []EcommerceReference {
	if draft.LayoutReferences != nil {
		return draft.LayoutReferences
	}
	if draft.LayoutReferenceID != "" {
		for _, reference := range draft.References {
			if reference.ResourceID == draft.LayoutReferenceID && reference.Role != "model" && reference.Role != "logo" {
				return []EcommerceReference{reference}
			}
		}
		return nil
	}
	var sources []EcommerceReference
	for _, reference := range draft.References {
		if isEcommerceLayoutRole(reference.Role) {
			sources = append(sources, reference)
		}
	}
	return sources
}

func (s *Service) validateEcommerceReferenceDraft(userID string, draft *EcommerceDraft, hasPlan bool) error {
	switch draft.ReferenceMode {
	case "", "product", "style", "detail", "layout":
	default:
		return BadAuthRequest("参考模式无效，请重新选择")
	}
	active := draft.ReferenceMode == "style" || draft.ReferenceMode == "detail" || draft.ReferenceMode == "layout"
	separated := draft.LayoutReferences != nil
	layout := draft.ReferenceMode == "layout"
	if layout && len(draft.LayoutReferences) > 10 {
		return BadAuthRequest("最多可上传 10 张参考图")
	}
	found := false
	sourceRole := ""
	hasPrimary := false
	for _, reference := range draft.References {
		if reference.Width < 0 || reference.Height < 0 {
			return BadAuthRequest("参考图片尺寸无效")
		}
		if separated && isEcommerceLayoutRole(reference.Role) {
			return BadAuthRequest("风格与竞品图片须放入独立借鉴图片列表")
		}
		hasPrimary = hasPrimary || reference.Role == "primary"
		if reference.ResourceID == draft.LayoutReferenceID {
			found = true
			sourceRole = reference.Role
		}
	}
	seen := make(map[string]bool, len(draft.LayoutReferences))
	for _, reference := range draft.LayoutReferences {
		if !isEcommerceLayoutRole(reference.Role) {
			return BadAuthRequest("借鉴图片只能使用风格或竞品用途，不能作为商品素材")
		}
		if reference.Width < 0 || reference.Height < 0 || reference.ResourceID == "" || seen[reference.ResourceID] {
			return BadAuthRequest("借鉴图片ID、尺寸无效或图片重复")
		}
		seen[reference.ResourceID] = true
		if reference.ResourceID == draft.LayoutReferenceID {
			found = true
			sourceRole = reference.Role
		}
	}
	if layout {
		for _, product := range draft.References {
			if seen[product.ResourceID] || product.ResourceID == "" {
				return BadAuthRequest("商品图与参考图不能重复，请检查上传的图片")
			}
			seen[product.ResourceID] = true
		}
		if !separated || !hasPrimary || len(draft.LayoutReferences) == 0 {
			return BadAuthRequest("请分别上传商品图与参考图")
		}
	}
	if draft.LayoutReferenceID != "" && !found {
		if active && !separated {
			return BadAuthRequest("版式参考图必须属于本项目已添加的参考图片")
		}
		resource, err := s.repo.ResourceForUser(userID, draft.LayoutReferenceID)
		if err != nil || resource.Kind != "image" || resource.Status != model.ResourceStatusReady {
			return BadAuthRequest("版式参考图不存在或不属于当前用户")
		}
		// Removing an inactive source should not leave a dangling deletion-protection reference.
		draft.LayoutReferenceID = ""
	}
	if active && !separated && (sourceRole == "model" || sourceRole == "logo") {
		return BadAuthRequest("模特图或品牌标识不能作为版式参考来源")
	}
	if hasPlan && active {
		if len(ecommerceLayoutSources(*draft)) == 0 {
			return BadAuthRequest("参考方案缺少独立借鉴图片，请添加后重新策划")
		}
		if separated && !hasPrimary {
			return BadAuthRequest("请先上传商品主图，借鉴图片不能代替真实商品素材")
		}
	}
	return nil
}

func ecommerceLayoutPlanningReferences(draft EcommerceDraft) []model.EcommerceExecutionReference {
	refs := make([]model.EcommerceExecutionReference, 0, len(draft.References)+len(draft.LayoutReferences))
	for _, ref := range draft.References {
		if ref.Role != "model" || draft.ModelEnabled {
			refs = append(refs, model.EcommerceExecutionReference{ID: ref.ResourceID, Name: defaultString(ref.Name, "商品图"), StorageKey: "resource:" + ref.ResourceID})
		}
	}
	for _, ref := range draft.LayoutReferences {
		refs = append(refs, model.EcommerceExecutionReference{ID: ref.ResourceID, Name: defaultString(ref.Name, "参考图"), StorageKey: "resource:" + ref.ResourceID})
	}
	return refs
}

func sameEcommerceLayoutPlanningReferences(draft EcommerceDraft, planned []model.EcommerceExecutionReference) bool {
	return slices.EqualFunc(ecommerceLayoutPlanningReferences(draft), planned, func(expected, actual model.EcommerceExecutionReference) bool {
		return expected.ID == actual.ID
	})
}

func ecommerceLayoutPlanningPrompt(draft EcommerceDraft) string {
	layoutStart := len(ecommerceLayoutPlanningReferences(draft)) - len(draft.LayoutReferences)
	var prompt strings.Builder
	prompt.WriteString("\n【本轮参考版式与出图合同】上传的原图版式优先于上文的模板、推荐风格、固定页型、机位和图文规范示例。整套视觉保持参考原图的图文位置、留白、信息层级、配色和光影。用户明确填写的补充要求、文案语言、张数、分辨率和比例优先。不要复制参考图中的商品、商标、数字、价格、认证或其他文字。商品视觉风格字段描述商品本身，不替换参考图的版式。\n")
	fmt.Fprintf(&prompt, "输入的前 %d 张是商品/商品相关素材，其余为下列原始参考图。逐张按实际像素分析，在 images 前输出 referenceSummary 和 referenceObservations。referenceObservations 必须按下列顺序全量输出，每项必须包含 resourceId、layout（图文位置和信息层级）、visual（配色、光影和实际画面）。无法看清时不要编造分析。\n", layoutStart)
	for index, ref := range draft.LayoutReferences {
		fmt.Fprintf(&prompt, "输入第 %d 张，参考图 %d，resourceId=%s\n", layoutStart+index+1, index+1, ref.ResourceID)
	}
	for index := range draft.Count {
		fmt.Fprintf(&prompt, "输出第 %d 张按参考图 %d 的实际版式策划。\n", index+1, index%len(draft.LayoutReferences)+1)
	}
	return prompt.String()
}

func (s *Service) validateEcommerceReferencePlan(userID string, draft EcommerceDraft, plan *model.EcommercePlan) error {
	return s.validateEcommerceReferencePlanPrefix(userID, draft, plan, false)
}

func (s *Service) validateEcommerceReferencePlanPrefix(userID string, draft EcommerceDraft, plan *model.EcommercePlan, partial bool) error {
	active := draft.ReferenceMode == "style" || draft.ReferenceMode == "detail" || draft.ReferenceMode == "layout"
	if len(plan.ReferenceSummary) > 32000 {
		return BadAuthRequest("参考图分析摘要过长")
	}
	if active && strings.TrimSpace(plan.ReferenceSummary) == "" {
		return BadAuthRequest("参考方案缺少借鉴图片分析摘要，请重新策划")
	}
	sources := ecommerceLayoutSources(draft)
	if draft.ReferenceMode == "layout" {
		if len(sources) == 0 || len(plan.ReferenceObservations) != len(sources) {
			return BadAuthRequest("参考图分析未覆盖每张上传图片，请重新策划")
		}
		for index, observation := range plan.ReferenceObservations {
			if observation.ResourceID != sources[index].ResourceID || strings.TrimSpace(observation.Layout) == "" || strings.TrimSpace(observation.Visual) == "" || len(observation.Layout)+len(observation.Visual) > 8000 {
				return BadAuthRequest(fmt.Sprintf("第 %d 张参考图的版式或视觉分析不完整，请重新策划", index+1))
			}
		}
	}
	references := make(map[string]int, len(sources))
	for index, reference := range sources {
		if _, duplicate := references[reference.ResourceID]; duplicate {
			return BadAuthRequest("借鉴图片不能重复")
		}
		references[reference.ResourceID] = index
	}
	detail := draft.ReferenceMode == "detail"
	previousBottom := 0.0
	groupIndex := -1
	for index, image := range plan.Images {
		if draft.ReferenceMode == "layout" {
			if _, found := references[image.LayoutReferenceID]; !found || image.ReferenceScreen != nil {
				return BadAuthRequest(fmt.Sprintf("第 %d 张方案缺少对应的参考图", index+1))
			}
		}
		screen := image.ReferenceScreen
		if screen == nil {
			if detail {
				return BadAuthRequest(fmt.Sprintf("第%d屏缺少详情参考分析，请重新策划", index+1))
			}
			continue
		}
		position, found := references[screen.SourceResourceID]
		if screen.SourceResourceID == "" || !found {
			return BadAuthRequest(fmt.Sprintf("第%d屏的来源与所选参考图不一致", index+1))
		}
		if screen.ScreenIndex < 1 || screen.ScreenIndex > 30 || (detail && screen.ScreenIndex != index+1) {
			return BadAuthRequest("详情参考屏次必须从1开始按顺序排列")
		}
		if math.IsNaN(screen.Top) || math.IsNaN(screen.Bottom) || math.IsInf(screen.Top, 0) || math.IsInf(screen.Bottom, 0) || screen.Top < 0 || screen.Bottom > 1 || screen.Top >= screen.Bottom {
			return BadAuthRequest(fmt.Sprintf("第%d屏的参考范围无效，应满足0≤top<bottom≤1", index+1))
		}
		if strings.TrimSpace(screen.Content) == "" || strings.TrimSpace(screen.Layout) == "" || strings.TrimSpace(screen.Visual) == "" {
			return BadAuthRequest(fmt.Sprintf("第%d屏缺少内容、排版或画面分析", index+1))
		}
		if len(screen.Content)+len(screen.Layout)+len(screen.Visual)+len(screen.SourceCopy) > 32000 {
			return BadAuthRequest(fmt.Sprintf("第%d屏的参考分析过长", index+1))
		}
		if detail {
			if position != groupIndex {
				if position != groupIndex+1 || (groupIndex >= 0 && math.Abs(previousBottom-1) > 0.010000001) {
					return BadAuthRequest("详情屏须按借鉴图片顺序完整分组，不能遗漏、交错或倒序")
				}
				groupIndex = position
				previousBottom = 0
			}
			// Small model rounding differences are acceptable; omitted or reordered sections are not.
			if math.Abs(screen.Top-previousBottom) > 0.010000001 || screen.Bottom <= previousBottom {
				return BadAuthRequest("详情参考范围须按原图从上到下连续覆盖，不能缺屏、重叠或倒序")
			}
			previousBottom = screen.Bottom
		}
		if screen.ResourceID != "" {
			resource, err := s.repo.ResourceForUser(userID, screen.ResourceID)
			if err != nil || resource.Kind != "image" || resource.Status != model.ResourceStatusReady {
				return BadAuthRequest(fmt.Sprintf("第%d屏的裁剪图片不存在或不属于当前用户", index+1))
			}
		}
	}
	if detail && !partial && (groupIndex != len(sources)-1 || groupIndex < 0 || math.Abs(previousBottom-1) > 0.010000001) {
		return BadAuthRequest("详情参考须完整覆盖每张借鉴图片及其底部，请重新策划")
	}
	return nil
}
