package app

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"gorm.io/driver/postgres"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"yingce/backend/internal/database"
	"yingce/backend/internal/model"
)

func knowledgeTestService(t *testing.T) (*Service, *gorm.DB) {
	t.Helper()
	options := &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)}
	var db *gorm.DB
	var err error
	if dsn := os.Getenv("CANVAS_TEST_POSTGRES_DSN"); dsn != "" {

		admin, openErr := gorm.Open(postgres.Open(dsn), options)
		if openErr != nil {
			t.Fatal(openErr)
		}
		schema := "kb_test_" + strings.ReplaceAll(newID(), "-", "")[:16]
		if err := admin.Exec("CREATE SCHEMA " + schema).Error; err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() {
			_ = admin.Exec("DROP SCHEMA " + schema + " CASCADE").Error
			if sqlDB, err := admin.DB(); err == nil {
				_ = sqlDB.Close()
			}
		})
		separator := "?"
		if strings.Contains(dsn, "?") {
			separator = "&"
		}
		db, err = gorm.Open(postgres.Open(dsn+separator+"search_path="+schema), options)
	} else {
		db, err = gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "knowledge.db")+"?_journal_mode=WAL&_busy_timeout=5000"), options)
	}
	if err != nil {
		t.Fatal(err)
	}
	if err := database.MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	if err := database.RequireSchemaVersion(db); err != nil {
		t.Fatal(err)
	}
	svc, db, _, _ := creationTestServiceOnDatabase(t, db)
	if err := db.Create(&model.User{ID: "admin", Username: "admin", Role: model.UserRoleAdmin, Status: model.UserStatusActive}).Error; err != nil {
		t.Fatal(err)
	}
	return svc, db
}
