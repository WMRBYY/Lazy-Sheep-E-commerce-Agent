package skills

import "testing"

func TestSkillPresetsCatalogIsValid(t *testing.T) {
	presets, err := New(nil, "", nil).SkillPresets()
	if err != nil {
		t.Fatal(err)
	}
	if len(presets) != 0 {
		t.Fatal("公开版不得附带原站技能预设")
	}
	seeded := make(map[string]struct{}, 128)
	ids, err := builtinSeedSkillIDs()
	if err != nil {
		t.Fatal(err)
	}
	for _, id := range ids {
		seeded[id] = struct{}{}
	}
	for _, preset := range presets {
		if len(preset.SkillIDs) == 0 || len(preset.SkillIDs) > 8 {
			t.Fatalf("%s 技能数超出 1-8", preset.PresetID)
		}
		for _, skillID := range preset.SkillIDs {
			if _, ok := seeded[skillID]; !ok {
				t.Fatalf("%s 引用未上架技能 %s", preset.PresetID, skillID)
			}
		}
	}
}
