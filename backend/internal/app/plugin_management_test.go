package app

import (
	"testing"

	"yingce/backend/internal/protocol"
)

func TestUploadedManifestCannotClaimUserActivationScope(t *testing.T) {
	policy := pluginManagement(PluginPromptOptimizer, PluginOriginUploaded)
	if policy.Origin != PluginOriginUploaded || policy.ActivationScope != PluginScopeSystem || policy.ConfigurationScope != PluginConfigurationSystem {
		t.Fatalf("uploaded plugin policy = %#v", policy)
	}
}

func TestPaymentContributionInfersPaymentManagementKind(t *testing.T) {
	plugin := PluginView{
		Source: PluginOriginOfficial,
		Manifest: PluginManifestView{
			ID: "official-payment-xunhupay",
			Contributes: protocol.ManifestContributions{PaymentProviders: []protocol.ManifestPaymentProvider{{
				ID: "xunhupay-aggregate", Label: "虎皮椒聚合支付", Icon: "assets/icon.svg", CheckoutMode: "qr_code",
			}}},
		},
	}
	policy := pluginManagementFromView(plugin)
	if policy.Kind != PluginKindPayment || policy.Origin != PluginOriginOfficial || policy.ActivationScope != PluginScopeSystem {
		t.Fatalf("inferred payment policy = %#v", policy)
	}
}

func TestArtCritiqueIsUserToggleableApplication(t *testing.T) {
	policy := pluginManagement(PluginAIArtCritique, "bundled")
	if policy.Origin != PluginOriginOfficial || policy.Kind != PluginKindApplication || policy.ActivationScope != PluginScopeUser || policy.ConfigurationScope != PluginConfigurationNone {
		t.Fatalf("AI art critique policy = %#v", policy)
	}
}
