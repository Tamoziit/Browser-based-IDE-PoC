import { useNavigate } from "react-router-dom";
import type { SubmissionResult } from "../interfaces"

interface SubmissionResultProps {
	submissionResult: SubmissionResult;
}

const ResultPanel = ({ submissionResult }: SubmissionResultProps) => {
	const navigate = useNavigate();

	return (
		<div className="boot-screen submitted-screen">
			<div className="result-panel">
				<div className="result-header">
					<div className="result-score-circle">
						<svg viewBox="0 0 36 36" className="circular-chart">
							<path className="circle-bg"
								d="M18 2.0845
									a 15.9155 15.9155 0 0 1 0 31.831
									a 15.9155 15.9155 0 0 1 0 -31.831"
							/>
							<path className="circle"
								strokeDasharray="100, 100"
								style={{ strokeDashoffset: 100 - submissionResult.percentage }}
								d="M18 2.0845
									a 15.9155 15.9155 0 0 1 0 31.831
									a 15.9155 15.9155 0 0 1 0 -31.831"
							/>
							<text x="18" y="20.35" className="percentage">{submissionResult.percentage}%</text>
						</svg>
					</div>
					<h2 className="submitted-title">Lab Evaluated</h2>
					<p className="submitted-sub">You completed {submissionResult.score} out of {submissionResult.maxScore} steps.</p>
				</div>

				<div className="result-details">
					{submissionResult.results.map((r, i) => (
						<div key={i} className={`result-item ${r.passed ? 'passed' : 'failed'}`}>
							<span className="result-icon">{r.passed ? '✓' : '✗'}</span>
							<div className="result-text">
								<div className="result-step">{r.step}</div>
								{r.details && <div className="result-error">{r.details}</div>}
							</div>
						</div>
					))}
				</div>

				<button className="btn btn-submit btn-return-home" onClick={() => navigate("/", { replace: true })}>
					Return to Dashboard
				</button>
			</div>
		</div>
	)
}

export default ResultPanel;