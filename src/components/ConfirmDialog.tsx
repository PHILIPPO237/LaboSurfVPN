import React from 'react';
import { useApp } from '../context/AppContext';
import { useI18n } from '../i18n';

export const ConfirmDialog: React.FC = () => {
  const { dialog, closeDialog } = useApp();
  const { t } = useI18n();

  if (!dialog) return null;

  const handleConfirm = () => {
    dialog.onConfirm();
    closeDialog();
  };

  const handleCancel = () => {
    if (dialog.onCancel) dialog.onCancel();
    closeDialog();
  };

  return (
    <div className="dialog-backdrop" id="dialogBackdrop" onClick={handleCancel}>
      <div
        className="dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="dialogTitle"
        aria-describedby="dialogText"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="dialogTitle">{dialog.title}</h2>
        <p id="dialogText">{dialog.message}</p>
        <div className="btn-row">
          <button className="btn btn-secondary" type="button" onClick={handleCancel}>
            {dialog.cancel || t('common.cancel')}
          </button>
          <button
            className={`btn ${dialog.danger ? 'btn-danger' : 'btn-primary'}`}
            type="button"
            onClick={handleConfirm}
          >
            {dialog.confirm || t('common.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
};
