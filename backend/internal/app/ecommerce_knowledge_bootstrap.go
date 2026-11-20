package app

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

// Public builds have no bundled knowledge records.
const ecommerceBuiltinKnowledgePrefix = "meiye-kb"

type ecommerceBuiltinSourceSpec struct {
	Domain, Name, URL string
}

var ecommerceBuiltinSourceSpecs = []ecommerceBuiltinSourceSpec{}

func ecommerceBuiltinSourceID(domain string) string {
	return ecommerceBuiltinKnowledgePrefix + strings.TrimPrefix(strings.ToLower(domain), "kb")
}

// ecommerceBuiltinKnowledgeEntries returns normalized KB01-KB10 entries.
// Timestamps are left zero; the bootstrap assigns them at write time.
// Public builds ship no knowledge records. Deployments own their imported data.
func ecommerceBuiltinKnowledgeEntries() []model.EcommerceKnowledgeEntry { return nil }

func ecommerceKnowledgeContentHash(entry model.EcommerceKnowledgeEntry) string {
	sum := sha256.Sum256([]byte(strings.Join([]string{entry.ID, entry.SourceID, entry.KnowledgeDomain, entry.KnowledgeType, entry.Category, entry.Title, entry.ContentJSON, entry.PlatformsJSON, entry.LanguagesJSON, entry.RegionsJSON, entry.TagsJSON}, "\x1f")))
	return hex.EncodeToString(sum[:])
}

var ecommerceKnowledgeRevision = regexp.MustCompile(`-v(\d+)-(\d{8})$`)

// ecommerceKnowledgeVersionNewer reports whether shipped is a later revision
// than stored. Unknown formats only upgrade when the strings differ and the
// stored value is not parseable, so a newer database is never downgraded by
// an older binary.
func ecommerceKnowledgeVersionNewer(shipped, stored string) bool {
	if shipped == stored {
		return false
	}
	a, b := ecommerceKnowledgeRevision.FindStringSubmatch(shipped), ecommerceKnowledgeRevision.FindStringSubmatch(stored)
	if a == nil {
		return false
	}
	if b == nil {
		return true
	}
	ar, _ := strconv.Atoi(a[1])
	br, _ := strconv.Atoi(b[1])
	if ar != br {
		return ar > br
	}
	return a[2] > b[2]
}

type EcommerceKnowledgeBootstrapReport struct {
	Shipped        int                         `json:"shipped"`
	Inserted       []string                    `json:"inserted"`
	Updated        []string                    `json:"updated"`
	Unchanged      int                         `json:"unchanged"`
	PreservedLocal []string                    `json:"preservedLocal"`
	SourcesCreated []string                    `json:"sourcesCreated"`
	ByDomain       map[string]map[string]int64 `json:"byDomain"`
}

// EnsureBuiltinEcommerceKnowledge copies shipped KB01-KB10 entries into the
// database in one transaction:
//   - a missing ID is inserted;
//   - a stored row whose hash still equals its content and whose version is
//     older is upgraded in place (review status kept);
//   - a stored row edited outside the bootstrap (hash mismatch) is preserved
//     and reported, never overwritten;
//   - any error rolls back the whole run.
func (s *Service) EnsureBuiltinEcommerceKnowledge() (*EcommerceKnowledgeBootstrapReport, error) {
	return s.ensureBuiltinEcommerceKnowledge(ecommerceBuiltinKnowledgeEntries())
}

func (s *Service) ensureBuiltinEcommerceKnowledge(entries []model.EcommerceKnowledgeEntry) (*EcommerceKnowledgeBootstrapReport, error) {
	report := &EcommerceKnowledgeBootstrapReport{Shipped: len(entries), Inserted: []string{}, Updated: []string{}, PreservedLocal: []string{}, SourcesCreated: []string{}}
	seen := map[string]bool{}
	for _, entry := range entries {
		if seen[entry.ID] {
			return nil, fmt.Errorf("内置知识 ID 重复：%s", entry.ID)
		}
		seen[entry.ID] = true
	}
	now := time.Now().UTC()
	err := s.repo.Transaction(func(tx *repository.Repository) error {
		versions := map[string]string{}
		for _, entry := range entries {
			if entry.Version > versions[entry.SourceID] {
				versions[entry.SourceID] = entry.Version
			}
		}
		for _, spec := range ecommerceBuiltinSourceSpecs {
			id := ecommerceBuiltinSourceID(spec.Domain)
			source := &model.EcommerceKnowledgeSource{ID: id, Name: spec.Name, URL: spec.URL, License: "MeiYeAI " + spec.Domain + " Original", Version: versions[id], Status: "ready", LastSyncedAt: &now}
			if spec.Domain == "KB15" || spec.Domain == "KB16" || spec.Domain == "KB17" {
				source.License = "MIT / MeiYeAI Original"
			}
			if _, err := tx.EcommerceKnowledgeSource(id); errors.Is(err, gorm.ErrRecordNotFound) {
				if err := tx.CreateEcommerceKnowledgeSource(source); err != nil {
					return fmt.Errorf("创建知识源 %s：%w", id, err)
				}
				report.SourcesCreated = append(report.SourcesCreated, id)
			} else if err != nil {
				return err
			} else if err := tx.UpdateBuiltinEcommerceKnowledgeSource(source); err != nil {
				return fmt.Errorf("更新知识源 %s：%w", id, err)
			}
		}
		for _, shipped := range entries {
			entry := shipped
			stored, err := tx.EcommerceKnowledgeEntryByID(entry.ID)
			if errors.Is(err, gorm.ErrRecordNotFound) {
				entry.CreatedAt, entry.UpdatedAt = now, now
				if err := tx.CreateEcommerceKnowledgeEntry(&entry); err != nil {
					return fmt.Errorf("写入知识 %s：%w", entry.ID, err)
				}
				report.Inserted = append(report.Inserted, entry.ID)
				continue
			}
			if err != nil {
				return err
			}
			if stored.DedupHash == entry.DedupHash || !ecommerceKnowledgeVersionNewer(entry.Version, stored.Version) {
				report.Unchanged++
				continue
			}
			if ecommerceKnowledgeContentHash(*stored) != stored.DedupHash {
				report.PreservedLocal = append(report.PreservedLocal, entry.ID)
				continue
			}
			ok, err := tx.UpdateBuiltinEcommerceKnowledgeEntry(entry.ID, stored.DedupHash, &entry)
			if err != nil {
				return fmt.Errorf("升级知识 %s：%w", entry.ID, err)
			}
			if !ok {
				return fmt.Errorf("升级知识 %s 时记录已被并发修改", entry.ID)
			}
			report.Updated = append(report.Updated, entry.ID)
		}
		counts, err := tx.EcommerceKnowledgeDomainStatusCounts(ecommerceBuiltinKnowledgePrefix)
		report.ByDomain = counts
		return err
	})
	if err != nil {
		return nil, err
	}
	sort.Strings(report.PreservedLocal)
	return report, nil
}

// ecommerceBuiltinKnowledgeFallback supplies shipped entries only for domains
// whose source row has never been bootstrapped. Once a source exists the
// database is authoritative, so disabling or rejecting knowledge takes effect.
func ecommerceBuiltinKnowledgeFallback(sources []model.EcommerceKnowledgeSource) []model.EcommerceKnowledgeEntry {
	present := map[string]bool{}
	for _, source := range sources {
		present[source.ID] = true
	}
	fallback := []model.EcommerceKnowledgeEntry{}
	for _, entry := range ecommerceBuiltinKnowledgeEntries() {
		if !present[entry.SourceID] {
			fallback = append(fallback, entry)
		}
	}
	if len(fallback) > 0 {
		slog.Debug("ecommerce builtin knowledge fallback in use", "entries", len(fallback))
	}
	return fallback
}
