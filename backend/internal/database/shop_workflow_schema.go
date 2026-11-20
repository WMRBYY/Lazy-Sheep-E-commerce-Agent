package database

import (
	"fmt"

	"yingce/backend/internal/model"

	"gorm.io/gorm"
)

// MigrateShopWorkflowSchema adds the independent workflow table without changing
// either shared ledger, which older API and worker processes check for equality.
func MigrateShopWorkflowSchema(db *gorm.DB) error {
	return db.Transaction(func(tx *gorm.DB) error {
		if tx.Dialector.Name() == "postgres" {
			if err := tx.Exec("SET LOCAL lock_timeout = '3s'").Error; err != nil {
				return err
			}
			if err := tx.Exec("SET LOCAL statement_timeout = '20s'").Error; err != nil {
				return err
			}
			if err := tx.Exec("SELECT pg_advisory_xact_lock(?)", postgresSchemaMigrationLockID).Error; err != nil {
				return fmt.Errorf("获取工作流迁移锁：%w", err)
			}
		}
		return ensureShopWorkflowSchema(tx)
	})
}

func ensureShopWorkflowSchema(tx *gorm.DB) error {
	if tx.Migrator().HasTable(&model.ShopWorkflowSubmission{}) {
		return nil
	}
	if err := tx.AutoMigrate(&model.ShopWorkflowSubmission{}); err != nil {
		return fmt.Errorf("创建电商工作流投稿表：%w", err)
	}
	return nil
}
