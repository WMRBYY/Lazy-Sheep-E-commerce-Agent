package app

import (
	"encoding/json"
	"strings"

	"yingce/backend/internal/ecommercecatalog"
	"yingce/backend/internal/ecommerceskills"
	"yingce/backend/internal/model"
)

func ecommerceKnowledgeSkillEnabled(entry model.EcommerceKnowledgeEntry, policy map[string]bool, req EcommerceCreativeDirectionsRequest) bool {
	var data struct {
		SkillID string `json:"skillId"`
	}
	if json.Unmarshal([]byte(entry.ContentJSON), &data) != nil || data.SkillID == "" {
		return true
	}
	enabled, exists := policy[data.SkillID]
	if exists && !enabled {
		return false
	}
	for _, skill := range ecommerceskills.ManagedCatalog() {
		if skill.ID != data.SkillID {
			continue
		}
		if len(skill.RootIDs) > 0 {
			root := ecommercecatalog.ResolveProduct(req.Category, req.ProductName).Node.RootID
			matched := false
			for _, id := range skill.RootIDs {
				matched = matched || id == root
			}
			if !matched {
				return false
			}
		}
		has := func(values []string, value string) bool {
			for _, v := range values {
				if v == value {
					return true
				}
			}
			return false
		}
		if len(skill.Types) > 0 && req.ImageType != "" && !has(skill.Types, req.ImageType) {
			return false
		}
		if len(skill.Modes) > 0 && !has(skill.Modes, req.ReferenceMode) {
			return false
		}
		if skill.NeedsText && (req.ImageType == "white" || req.ImageType == "three-view") {
			return false
		}
		if skill.NeedsSpecs && strings.TrimSpace(req.Specifications) == "" {
			return false
		}
		if skill.RequireTerms {
			text := strings.ToLower(req.Category + " " + req.ProductName + " " + req.Description + " " + req.Instruction)
			matched := false
			for _, term := range skill.Terms {
				matched = matched || strings.Contains(text, strings.ToLower(term))
			}
			if !matched {
				return false
			}
		}
		return true
	}
	return false
}
