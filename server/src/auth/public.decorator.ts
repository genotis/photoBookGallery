import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** 인증 없이 접근 가능한 핸들러/컨트롤러에 표시한다. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
