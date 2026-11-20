import { apiBaseURL, compactApiParams, http } from "./request";

export type ProfileModerationRecord = {
    id: string;
    userId: string;
    username?: string;
    userDisplayName?: string;
    kind: "nickname" | "avatar";
    status: "pass" | "block" | "review" | "blocked";
    originalValue?: string;
    resultValue?: string;
    reason: string;
    model?: string;
    score?: number;
    createdAt: string;
};

export function listProfileModerationRecords(params: { status?: string; page?: number; pageSize?: number }, signal?: AbortSignal) {
    return http.get<{ records: ProfileModerationRecord[]; total: number; page: number; pageSize: number }>("/admin/profile-moderation", { params: compactApiParams(params), signal });
}

export function profileModerationImageUrl(id: string) {
    return `${apiBaseURL}/admin/profile-moderation/${encodeURIComponent(id)}/image`;
}
