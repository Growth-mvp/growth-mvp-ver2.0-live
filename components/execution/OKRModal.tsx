'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useUserStore } from '@/store/userStore';
import { saveProgressLog } from '@/utils/supabase';
import { Department } from '@/types/strategy';

type OKRModalProps = {
  department: Department;
  projectIndex: number;
  okrIndex: number;
  onClose: () => void;
};

export default function OKRModal({
  department,
  projectIndex,
  okrIndex,
  onClose,
}: OKRModalProps) {
  const { user } = useUserStore();

  const project = department?.projects?.[projectIndex];
  const okr = project?.okrs?.[okrIndex];

  if (!project || !okr) return null; // 安全対策

  const okrId = `${department.name}-${projectIndex}-${okrIndex}`;

  const [progressText, setProgressText] = useState('');
  const [rating, setRating] = useState(3); // 初期値3（1〜5）
  const [ratingComment, setRatingComment] = useState('');
  const [advice, setAdvice] = useState('');
  const [helpRequest, setHelpRequest] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!user?.id) return;

    setSaving(true);

    await saveProgressLog(user.id, okrId, {
      progressText,
      rating,
      ratingComment,
      advice,
      helpRequest,
      department: department.name,
    });

    setSaving(false);
    onClose();
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold mb-2">
            OKR詳細（{okr.objective || '未設定'}）
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-semibold mb-1">進捗コメント</label>
            <Textarea
              value={progressText}
              onChange={(e) => setProgressText(e.target.value)}
              placeholder="現在の進捗状況や課題を記入してください"
              className="w-full"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold mb-1">進捗評価（1〜5）</label>
            <Input
              type="number"
              min={1}
              max={5}
              value={rating}
              onChange={(e) => setRating(Number(e.target.value))}
              className="w-24"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold mb-1">評価理由</label>
            <Textarea
              value={ratingComment}
              onChange={(e) => setRatingComment(e.target.value)}
              placeholder="その評価をつけた理由を記入"
              className="w-full"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold mb-1">アドバイス・工夫</label>
            <Textarea
              value={advice}
              onChange={(e) => setAdvice(e.target.value)}
              placeholder="工夫している点や他メンバーへのアドバイス"
              className="w-full"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold mb-1">協力依頼・支援要望</label>
            <Textarea
              value={helpRequest}
              onChange={(e) => setHelpRequest(e.target.value)}
              placeholder="他部門やマネージャーへの協力依頼など"
              className="w-full"
            />
          </div>

          <div className="text-right">
            <Button onClick={handleSave} disabled={saving}>
              {saving ? '保存中...' : '保存する'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
