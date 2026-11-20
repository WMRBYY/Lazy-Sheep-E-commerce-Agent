package app

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"time"

	"yingce/backend/internal/model"
)

// These are reviewed excerpts, not executable skills or verified platform policy.
// Both the pinned source commit and exact document hash must match before approval.
type commerceReviewedExcerpt struct {
	Digest, Title, Guidance string
}

var commerceReviewedExcerpts = map[string]commerceReviewedExcerpt{}

func commerceApplyReviewedExcerpt(entry *model.EcommerceKnowledgeEntry, source commerceSourceSpec, path string, data []byte) bool {
	excerpt, ok := commerceReviewedExcerpts[source.ID+"/"+path]
	digest := sha256.Sum256(data)
	if !ok || hex.EncodeToString(digest[:]) != excerpt.Digest {
		return false
	}
	reviewed := commerceEntry(source, path, excerpt.Title, entry.KnowledgeType, entry.Category, "", excerpt.Guidance)
	content, _ := json.Marshal(map[string]string{"guidance": excerpt.Guidance, "upstreamSha256": excerpt.Digest, "reviewScope": "visual_guidance_only; excludes scripts, providers, unverified platform policy and commercial claims"})
	reviewed.ContentJSON = string(content)
	reviewed.ReviewStatus = "approved"
	reviewed.TrustLevel = "reviewed_community"
	now := time.Now().UTC()
	reviewed.VerifiedAt = &now
	*entry = reviewed
	return true
}
