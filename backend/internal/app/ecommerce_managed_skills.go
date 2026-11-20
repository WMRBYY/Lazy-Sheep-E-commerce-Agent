package app

import (
	"encoding/json"
	"fmt"
	"strings"

	"yingce/backend/internal/ecommercecatalog"
	"yingce/backend/internal/ecommerceskills"
	"yingce/backend/internal/model"
)

const ecommerceManagedSkillSettingPrefix = "ecommerce_managed_skill."

type EcommerceManagedSkill struct {
	ecommerceskills.ManagedSkill
	Enabled       bool   `json:"enabled"`
	AutoUpdate    bool   `json:"autoUpdate"`
	LastCheckedAt string `json:"lastCheckedAt"`
	SyncError     string `json:"syncError"`
}

func (s *Service) ecommerceManagedSkillPolicy() (map[string]bool, error) {
	settings, err := s.repo.SystemSettingsWithPrefix(ecommerceManagedSkillSettingPrefix, 1000)
	if err != nil {
		return nil, err
	}
	result := map[string]bool{}
	for _, setting := range settings {
		var value struct {
			Enabled bool `json:"enabled"`
		}
		if err := json.Unmarshal([]byte(setting.ValueJSON), &value); err != nil {
			return nil, fmt.Errorf("电商技能设置损坏：%w", err)
		}
		result[strings.TrimPrefix(setting.Key, ecommerceManagedSkillSettingPrefix)] = value.Enabled
	}
	return result, nil
}

func (s *Service) EcommerceManagedSkills(actor *model.User) ([]EcommerceManagedSkill, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	policy, err := s.ecommerceManagedSkillPolicy()
	if err != nil {
		return nil, err
	}
	installed, err := s.ecommerceInstalledSkills()
	if err != nil {
		return nil, err
	}
	result := []EcommerceManagedSkill{}
	for _, skill := range ecommerceskills.ManagedCatalog() {
		enabled, exists := policy[skill.ID]
		if !exists {
			enabled = true
		}
		result = append(result, EcommerceManagedSkill{ManagedSkill: skill, Enabled: enabled})
	}
	for _, item := range installed {
		enabled, exists := policy[item.ID]
		if !exists {
			enabled = true
		}
		result = append(result, EcommerceManagedSkill{ManagedSkill: item.ManagedSkill, Enabled: enabled, AutoUpdate: item.AutoUpdate, LastCheckedAt: item.LastCheckedAt.Format("2006-01-02 15:04 UTC"), SyncError: item.SyncError})
	}
	return result, nil
}

// Separate setting keys prevent concurrent switches on different skills
// from overwriting one another's administrator choices.

func (s *Service) ecommerceManagedSkillBlock(draft EcommerceDraft, strategy map[string]any) (string, []ecommerceskills.ManagedInvocation, error) {
	policy, err := s.ecommerceManagedSkillPolicy()
	if err != nil {
		return "", nil, err
	}
	category := draft.Category
	if brief, ok := strategy["brief"].(map[string]any); ok {
		category = stringValue(brief["category"]) + " " + category
	}
	query := ecommerceDraftKnowledgeRequest(draft)
	query.Category = category
	style := ecommerceDirectionLabel(strategy, draft) + " " + draft.Style + " " + draft.StylePrompt
	if rec := strategy["direction"]; rec != nil {
		raw, _ := json.Marshal(rec)
		style += " " + string(raw)
	}
	text := strings.Join([]string{category, draft.ProductName, draft.Description, draft.Instruction, draft.Claims, draft.Materials}, " ")
	if draft.ModelEnabled {
		text += " 模特"
	}
	roles := []string{}
	for _, ref := range draft.References {
		roles = append(roles, ref.Role)
	}
	if len(draft.LayoutReferences) > 0 || draft.LayoutReferenceID != "" {
		roles = append(roles, "layout")
	}
	noText := draft.NoText || draft.ImageType == "white" || draft.ImageType == "three-view" || (draft.CreativeOptions != nil && draft.CreativeOptions.TextMode == "none")
	match := ecommercecatalog.ResolveProduct(category, draft.ProductName)
	installed, err := s.ecommerceInstalledSkills()
	if err != nil {
		return "", nil, err
	}
	catalog := ecommerceskills.ManagedCatalog()
	for _, item := range installed {
		catalog = append(catalog, item.ManagedSkill)
	}
	calls, block := ecommerceskills.SelectCatalog(ecommerceskills.ManagedInput{RootID: match.Node.RootID, Category: ecommerceProductCategory(query), Text: text, ImageType: draft.ImageType, Platform: draft.Platform, ReferenceMode: draft.ReferenceMode, ReferenceRoles: roles, Style: style, PeopleAllowed: ecommercePeopleAllowed(draft), NoText: noText, HasSpecs: strings.TrimSpace(draft.Specifications+draft.Dimensions) != ""}, policy, catalog)
	context := ecommercecatalog.Context(match)
	if enabled, ok := policy["ecom-industry-"+match.Node.RootID]; ok && !enabled {
		context = ecommercecatalog.RoutingContext(match)
	}
	return context + block, calls, nil
}

func ecommerceManagedImageRules(metadata map[string]any) string {
	raw, err := json.Marshal(metadata["ecommerceManagedSkills"])
	if err != nil {
		return ""
	}
	var calls []ecommerceskills.ManagedInvocation
	if json.Unmarshal(raw, &calls) != nil {
		return ""
	}
	var rules []string
	for _, call := range calls {
		if call.ImageRule != "" {
			rules = append(rules, call.Name+"："+call.ImageRule)
		}
	}
	if len(rules) == 0 {
		return ""
	}
	return "【本轮已选Skills图片执行约束；仅对适用页面执行】\n" + strings.Join(rules, "\n")
}
