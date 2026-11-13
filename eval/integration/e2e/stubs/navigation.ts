/* 評価用：ルーターの代わり（検索パラメータは空） */
export const useSearchParams = () => new URLSearchParams();
export const useRouter = () => ({ push: () => {}, replace: () => {}, back: () => {}, refresh: () => {} });
export const usePathname = () => '/stage4';
export const useParams = () => ({});
export default {};
