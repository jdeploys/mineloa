import { TUTORIAL_LICENSE_URL, TUTORIAL_SOURCE_URL } from '../../../../shared/tutorialMeeting'

export function TutorialAttribution() {
  return <div className="tutorial-attribution">
    <div className="tutorial-instructions">
      <p>튜토리얼용 영어 회의입니다. 음원을 재생하고 화자별 전사·요약·할 일을 살펴보세요.</p>
      <p>전사는 AMI의 수동 전사이며, 요약은 미리 작성한 예제입니다. 이 기록은 자유롭게 삭제할 수 있습니다.</p>
    </div>
    <dl className="tutorial-source-details">
      <div><dt>원본 자료</dt><dd><a href={TUTORIAL_SOURCE_URL} target="_blank" rel="noreferrer">AMI Meeting Corpus ↗</a><span>ES2004a · 12:35–16:20</span></dd></div>
      <div><dt>라이선스</dt><dd><a href={TUTORIAL_LICENSE_URL} target="_blank" rel="noreferrer">CC BY 4.0 ↗</a><span>© AMI Consortium</span></dd></div>
      <div><dt>편집 내역</dt><dd>원본 음원의 일부를 발췌하고 형식을 변환했습니다. 전사는 발화 단위로 묶었으며, 요약과 안내는 Mineloa에서 작성했습니다.</dd></div>
    </dl>
  </div>
}
