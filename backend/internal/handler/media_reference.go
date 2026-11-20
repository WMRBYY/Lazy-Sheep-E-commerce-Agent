// Copyright (c) 2026 meiyeai. Licensed under the MIT License.
package handler

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"yingce/backend/internal/service"
)

// RegisterMediaReferenceRoutes serves ordinary video inputs without project workflows.
func RegisterMediaReferenceRoutes(r *gin.RouterGroup, svc *service.Service) {
	playback := func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		file, err := svc.OpenReferencePlayback(c.Request.Context(), user.ID, c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		defer file.Close()
		c.Header("Content-Type", "video/mp4")
		c.Header("Cache-Control", "private, no-cache")
		http.ServeContent(c.Writer, c.Request, "preview.mp4", time.Time{}, file)
	}
	r.GET("/media-references/playback/:id", playback)
	r.HEAD("/media-references/playback/:id", playback)
	r.POST("/media-references/preview", streamMediaReference(svc, false))
	r.POST("/media-references/clip", streamMediaReference(svc, true))
	r.POST("/media-references/save", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var req struct {
			ResourceID string                  `json:"resourceId"`
			Source     service.VideoLinkSource `json:"source"`
		}
		if err := decodeWorkbenchJSON(c, &req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		id, err := svc.SaveMediaReference(user.ID, req.ResourceID, req.Source)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"id": id})
	})
	r.GET("/video-parser/platforms", func(c *gin.Context) {
		if _, err := currentUser(c, svc); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"platforms": svc.VideoLinkPlatforms()})
	})
}

func streamMediaReference(svc *service.Service, clip bool) gin.HandlerFunc {
	return func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		policy, available := loadRuntimePolicy(c, svc)
		if !available || !enforceRateLimit(c, "media-reference:"+user.ID, policy.Request.ResourceUploadPerMinute, time.Minute) {
			return
		}
		var req struct {
			service.MediaReferenceLinkInput
			service.ReferenceClipInput
		}
		if err := decodeWorkbenchJSON(c, &req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		c.Header("Content-Type", "text/event-stream; charset=utf-8")
		c.Header("Cache-Control", "no-cache, no-store, no-transform")
		c.Header("Connection", "keep-alive")
		c.Header("X-Accel-Buffering", "no")
		c.Status(http.StatusOK)
		var mu sync.Mutex
		write := func(event service.VideoLinkEvent) {
			data, err := json.Marshal(event)
			if err != nil {
				return
			}
			mu.Lock()
			defer mu.Unlock()
			_, _ = fmt.Fprintf(c.Writer, "event: %s\ndata: %s\n\n", event.Event, data)
			c.Writer.Flush()
		}
		stop := make(chan struct{})
		defer func() {
			mu.Lock()
			close(stop)
			mu.Unlock()
		}()
		go func() {
			ticker := time.NewTicker(15 * time.Second)
			defer ticker.Stop()
			for {
				select {
				case <-stop:
					return
				case <-c.Request.Context().Done():
					return
				case <-ticker.C:
					mu.Lock()
					select {
					case <-stop:
						mu.Unlock()
						return
					default:
					}
					_, _ = fmt.Fprint(c.Writer, ": keepalive\n\n")
					c.Writer.Flush()
					mu.Unlock()
				}
			}
		}()
		var result *service.VideoLinkImportResult
		if clip {
			result, err = svc.ClipMediaReference(c.Request.Context(), user.ID, req.ReferenceClipInput, write)
		} else {
			result, err = svc.ImportMediaReferenceWithProgress(c.Request.Context(), user.ID, req.MediaReferenceLinkInput, write)
		}
		if err != nil {
			write(service.VideoLinkEvent{Event: "error", Error: service.VideoLinkErrorView(err)})
			return
		}
		write(service.VideoLinkEvent{Event: "result", Result: result})
	}
}
