// Copyright (c) 2026 meiyeai. Licensed under the MIT License.
import { Link } from "react-router";
export default function PrivacyPage() {
    return (
        <main className="min-h-screen bg-background px-4 py-10 text-foreground sm:px-6">
            <article className="mx-auto max-w-3xl space-y-6 rounded-2xl bg-card p-6 sm:p-12">
                <Link to="/" className="text-sm underline">
                    返回首页
                </Link>
                <h1 className="text-2xl font-semibold">部署站点隐私说明</h1>
                <p>此页面是自部署版本的隐私说明模板。站点运营者应在正式提供服务前补充运营主体、联系渠道、实际使用的服务商、数据保存期限和用户申请处理方式，并通过登录设置提供本站正式隐私说明。</p>
                <h2 className="text-lg font-semibold">账号与创作数据</h2>
                <p>账号信息、会话、上传素材、提示词、作品和任务记录由当前部署的运营者处理。具体保存位置、访问权限和保留期限，以该运营者公布的说明为准。</p>
                <h2 className="text-lg font-semibold">模型与支付服务</h2>
                <p>生成请求会将所选提示词和参考素材提交给此部署配置的服务商。支付功能是否启用、支付信息如何处理，也由当前部署配置决定。请在提交前查看本站运营者公布的正式说明。</p>
                <h2 className="text-lg font-semibold">申请与联系</h2>
                <p>查阅、更正、删除账号或创作数据等申请，应提交给当前部署的运营者。开源项目的署名方不自动成为任何第三方部署的运营者或数据处理方。</p>
                <p className="text-sm text-muted-foreground">开源项目署名：meiyeai</p>
            </article>
        </main>
    );
}
