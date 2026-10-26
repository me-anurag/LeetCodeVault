import { useNavigate } from 'react-router-dom'
import { TopBar } from '../phone/Sheet'
import { useIsPhone } from '../theme'
import StreakCalendar from '../war/StreakCalendar'
import { warToday } from '../war/time'

// Desktop page for the streak calendar (on phones it also opens from the war page's menu).
export default function Streak() {
  const navigate = useNavigate()
  const isPhone = useIsPhone()
  const pick = (date) => navigate(date === warToday() ? '/' : `/war/${date}`)
  return (
    <div className={`reader mx-auto max-w-md ${isPhone ? 'px-5' : 'pt-6'} pb-16`}>
      {isPhone && <TopBar onMenu={() => navigate('/')} />}
      <h1 className="mb-5 pt-5 text-[26px] font-semibold tracking-tight">Streak</h1>
      <StreakCalendar onPick={pick} />
    </div>
  )
}
