package database

import (
	"testing"

	"yingce/backend/internal/model"
)

func TestShopWorkflowMigrationKeepsSharedLedgers(t *testing.T) {
	db, err := Open(Config{Driver: "sqlite", DataDir: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	if err := db.Migrator().DropTable(&model.ShopWorkflowSubmission{}); err != nil {
		t.Fatal(err)
	}
	before, err := ReadSchemaStatus(db)
	if err != nil || before.Ready {
		t.Fatalf("missing feature table was reported ready: %+v %v", before, err)
	}
	for range 2 {
		if err := MigrateShopWorkflowSchema(db); err != nil {
			t.Fatal(err)
		}
	}
	after, err := ReadSchemaStatus(db)
	if err != nil || !after.Ready || after.Current != before.Current || after.YingceCurrent != before.YingceCurrent {
		t.Fatalf("shared ledgers changed or readiness failed: before=%+v after=%+v error=%v", before, after, err)
	}
}
