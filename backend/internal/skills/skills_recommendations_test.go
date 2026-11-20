package skills

import "testing"

func TestSkillRecommendationsReferenceBuiltinSkills(t *testing.T) {
	if err := ValidateSkillRecommendations(); err != nil {
		t.Fatal(err)
	}
	file, err := loadSkillRecommendations()
	if err != nil {
		t.Fatal(err)
	}
	if len(file.Industries) != 0 {
		t.Fatal("公开版不得附带原站技能推荐")
	}
}

func TestNormalizeSkillAgentModeDefaultsToAuto(t *testing.T) {
	for input, want := range map[string]string{"": "auto", "auto": "auto", "manual": "manual", "bogus": "auto"} {
		if got := NormalizeSkillAgentMode(input); got != want {
			t.Fatalf("NormalizeSkillAgentMode(%q)=%q want %q", input, got, want)
		}
	}
}
