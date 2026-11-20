package ecommerceskills

import (
	"strings"
	"testing"
)

func TestPublicEditionExcludesManagedSkillCorpus(t *testing.T) {
	if len(ManagedCatalog()) != 0 {
		t.Fatal("public edition must start without bundled managed skill data")
	}
}

func TestSelectCatalogAppliesReferenceRulesAndAdministratorPolicy(t *testing.T) {
	catalog := []ManagedSkill{
		{ID: "test-layout", Modes: []string{"detail"}, Priority: 20, Instructions: "Preserve layout"},
		{ID: "test-people", NeedsPeople: true, Priority: 20, Instructions: "Show people"},
	}
	input := ManagedInput{ReferenceMode: "detail", PeopleAllowed: false}
	calls, block := SelectCatalog(input, nil, catalog)
	if len(calls) != 1 || calls[0].ID != "test-layout" || !strings.Contains(block, "Preserve layout") {
		t.Fatalf("unexpected reference selection: %+v", calls)
	}
	if calls, block := SelectCatalog(input, map[string]bool{"test-layout": false}, catalog); len(calls) != 0 || block != "" {
		t.Fatal("disabled skill was selected")
	}
}
