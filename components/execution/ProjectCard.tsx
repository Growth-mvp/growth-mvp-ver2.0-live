// /components/execution/ProjectCard.tsx
'use client';

import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Project } from '@/types/strategy';
import { motion } from 'framer-motion';

interface Props {
  deptName: string;
  project: Project;
  onClick: () => void;
}

export default function ProjectCard({ deptName, project, onClick }: Props) {
  const okr = project.okrs?.[0];

  return (
    <motion.div
      whileHover={{ scale: 1.03 }}
      whileTap={{ scale: 0.98 }}
      className="cursor-pointer"
      onClick={onClick}
    >
      <Card className="p-4 shadow-xl border border-blue-200 bg-white hover:shadow-2xl transition-all rounded-2xl">
        <h2 className="text-md text-blue-800 font-semibold mb-2">{deptName}</h2>
        <h3 className="text-xl font-bold text-gray-800">{project.title}</h3>

        <div className="mt-2">
          <p className="text-sm text-gray-600 line-clamp-2">
            {okr?.objective || '未設定のObjective'}
          </p>
          <ul className="mt-2 list-disc list-inside text-gray-500 text-sm space-y-1">
            {(okr?.keyResults || []).map((kr, i) => (
              <li key={i}>{typeof kr === 'string' ? kr : String(kr)}</li>
            ))}
          </ul>
        </div>

        {okr?.owner && (
          <Badge className="mt-4" variant="default">
            {okr.owner}
          </Badge>
        )}
      </Card>
    </motion.div>
  );
}
